package discovery

import (
	"context"
	"encoding/csv"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"cloud.google.com/go/logging/logadmin"
	"google.golang.org/api/impersonate"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

type FilterService struct {
	adminClient *logadmin.Client
	ProjectID   string
	saJSON      string
}

func NewFilterService(ctx context.Context, projectID string, impersonateEmail string, saJSON string) (*FilterService, error) {
	var opts []option.ClientOption

	if saJSON != "" {
		opts = append(opts, option.WithCredentialsJSON([]byte(saJSON)))
	}

	if impersonateEmail != "" {
		ts, err := impersonate.CredentialsTokenSource(ctx, impersonate.CredentialsConfig{
			TargetPrincipal: impersonateEmail,
			Scopes:          []string{"https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/logging.admin"},
		}, opts...)
		if err != nil {
			return nil, fmt.Errorf("failed to create impersonated token source: %w", err)
		}
		opts = append(opts, option.WithTokenSource(ts))
	}

	adminClient, err := logadmin.NewClient(ctx, projectID, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create logadmin client: %w", err)
	}
	return &FilterService{adminClient: adminClient, ProjectID: projectID, saJSON: saJSON}, nil
}

type UnifiedResource struct {
	ResourceName string
	ProjectID    string
	Region       string
	Importance   string
	LastActivity string
	AssetType    string
	ResourcePath string
}

// StandardHeader defines the columns for all output CSVs in the critical-resources folder.
var StandardHeader = []string{"ResourceName", "ProjectID", "Region", "Importance", "LastActivity", "AssetType", "FullResourcePath", "NewRegion", "NewSubnet"}

// HeaderMap defines the source column names to look for in the original discovered CSVs.
var HeaderMap = map[string]string{
	"ResourceName":     "ResourceName",
	"ProjectID":        "ProjectID",
	"Region":           "Region",
	"AssetType":        "AssetType",
	"FullResourcePath": "FullResourcePath",
}

func (s *FilterService) FilterAndConsolidate(ctx context.Context, dataDir string, updateStatus func(string)) error {
	// 1. Get active resource names from logs in the last 30 days
	updateStatus("Analyzing usage logs from the last 15 days...")
	log.Println("Analyzing usage logs from the last 15 days...")
	activeResources, err := s.getActiveResourcesFromLogs(ctx)
	if err != nil {
		log.Printf("[WARNING] Could not fetch logs for usage verification: %v. Falling back to foundation-only filtering.", err)
		activeResources = make(map[string]string)
	}

	// 2. Map to hold active resources by type
	activeByType := make(map[string][]UnifiedResource)
	updateStatus("Consolidating discovered resources...")
	log.Println("Consolidating discovered resources...")

	// Create subfolder for active resources
	activeSubDir := filepath.Join(dataDir, os.Getenv("TERRAFORM_CRITICAL_RESOURCE"))
	if err := os.MkdirAll(activeSubDir, 0755); err != nil {
		return fmt.Errorf("failed to create %s dir: %w", os.Getenv("TERRAFORM_CRITICAL_RESOURCE"), err)
	}

	files, _ := filepath.Glob(filepath.Join(dataDir, "*.csv"))
	for _, file := range files {
		// Skip our output files and subdirs
		if strings.Contains(file, os.Getenv("TERRAFORM_CRITICAL_RESOURCE")) || strings.Contains(file, "active_important_resources") {
			continue
		}

		serviceType := strings.TrimSuffix(filepath.Base(file), ".csv")
		updateStatus(fmt.Sprintf("Processing %s...", serviceType))
		rows, err := readCSVRows(file)
		if err != nil {
			log.Printf("Failed to read CSV %s: %v", file, err)
			continue
		}

		if len(rows) < 2 {
			continue
		}
		header := rows[0]

		// Create a map of header name to column index for the current file
		colIndexMap := make(map[string]int)
		for i, h := range header {
			colIndexMap[h] = i
		}

		for i := 1; i < len(rows); i++ {
			row := rows[i]
			resName := getColumnValue(row, colIndexMap, HeaderMap["ResourceName"])

			// Importance Logic
			importance := "Normal"
			lowerType := strings.ToLower(serviceType)

			// Use exact matches to avoid including unwanted related resources.
			if lowerType == "sqladmin.instance" || lowerType == "compute.instance" {
				importance = "High"
			}

			lastActivity, isActive := activeResources[resName]

			if importance == "High" || isActive {
				// Add detailed logging to explain why a resource is being selected.
				reason := ""
				if importance == "High" {
					reason = "High Importance"
				} else {
					reason = "Recent Activity"
				}
				log.Printf("Selecting resource '%s' (type: %s). Reason: %s.", resName, serviceType, reason)

				if lastActivity == "" {
					lastActivity = "Unknown (Always Important)"
				}

				activeByType[serviceType] = append(activeByType[serviceType], UnifiedResource{
					ResourceName: resName,
					ProjectID:    getColumnValue(row, colIndexMap, HeaderMap["ProjectID"]),
					Region:       getColumnValue(row, colIndexMap, HeaderMap["Region"]),
					Importance:   importance,
					LastActivity: lastActivity,
					AssetType:    getColumnValue(row, colIndexMap, HeaderMap["AssetType"]),
					ResourcePath: getColumnValue(row, colIndexMap, HeaderMap["FullResourcePath"]),
				})
			}
		}
	}

	// 3. Write separate CSVs for each active resource type
	for serviceType, data := range activeByType {
		updateStatus(fmt.Sprintf("Writing active list for %s...", serviceType))
		fileName := filepath.Join(activeSubDir, fmt.Sprintf("%s.csv", serviceType))
		if err := writeActiveCSV(fileName, StandardHeader, data); err != nil {
			log.Printf("Failed to write active CSV %s: %v", fileName, err)
		}
	}

	updateStatus("Filter process completed.")

	return nil
}

func (s *FilterService) getActiveResourcesFromLogs(ctx context.Context) (map[string]string, error) {
	active := make(map[string]string)
	fifteenDaysAgo := time.Now().AddDate(0, 0, -15).Format(time.RFC3339)
	filter := fmt.Sprintf("timestamp >= %q AND (protoPayload.resourceName:* OR protoPayload.methodName:*)", fifteenDaysAgo)

	it := s.adminClient.Entries(ctx, logadmin.Filter(filter))
	for {
		entry, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}

		resName := ""
		if entry.Payload != nil {
			if payloadMap, ok := entry.Payload.(map[string]interface{}); ok {
				if proto, ok := payloadMap["protoPayload"].(map[string]interface{}); ok {
					if name, ok := proto["resourceName"].(string); ok {
						parts := strings.Split(name, "/")
						resName = parts[len(parts)-1]
					}
				}
			}
		}

		if resName == "" && entry.Resource != nil && entry.Resource.Labels != nil {
			labels := entry.Resource.Labels
			possibleKeys := []string{"instance_id", "name", "bucket_name", "cluster_name", "database_id", "topic_id", "subscription_id"}
			for _, key := range possibleKeys {
				if val, ok := labels[key]; ok {
					resName = val
					break
				}
			}
		}

		if resName != "" {
			active[resName] = entry.Timestamp.Format(time.RFC1123)
		}
	}

	return active, nil
}

func readCSVRows(fileName string) ([][]string, error) {
	file, err := os.Open(fileName)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return csv.NewReader(file).ReadAll()
}

func getColumnValue(row []string, colIndexMap map[string]int, colName string) string {
	if idx, ok := colIndexMap[colName]; ok && idx < len(row) {
		return row[idx]
	}
	return "" // Return empty string if column doesn't exist or row is malformed
}

func writeActiveCSV(fileName string, header []string, data []UnifiedResource) error {
	file, err := os.Create(fileName)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	writer.Write(header)
	for _, res := range data {
		writer.Write([]string{
			res.ResourceName,
			res.ProjectID,
			res.Region,
			res.Importance,
			res.LastActivity,
			res.AssetType,
			res.ResourcePath,
			"", // Placeholder for NewRegion
			"", // Placeholder for NewSubnet
		})
	}
	return nil
}
