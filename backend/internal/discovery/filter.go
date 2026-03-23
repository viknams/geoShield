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

func (s *FilterService) FilterAndConsolidate(ctx context.Context, dataDir string) error {
	// 1. Get active resource names from logs in the last 30 days
	activeResources, err := s.getActiveResourcesFromLogs(ctx)
	if err != nil {
		log.Printf("[WARNING] Could not fetch logs for usage verification: %v. Falling back to foundation-only filtering.", err)
		activeResources = make(map[string]string) 
	}

	// 2. Map to hold active resources by type
	activeByType := make(map[string][]UnifiedResource)

	// Create subfolder for active resources
	activeSubDir := filepath.Join(dataDir, "active-resources")
	if err := os.MkdirAll(activeSubDir, 0755); err != nil {
		return fmt.Errorf("failed to create active-resources dir: %w", err)
	}

	files, _ := filepath.Glob(filepath.Join(dataDir, "*.csv"))
	for _, file := range files {
		// Skip our output files and subdirs
		if strings.Contains(file, "active-resources") || strings.Contains(file, "active_important_resources") {
			continue
		}

		serviceType := strings.TrimSuffix(filepath.Base(file), ".csv")
		rows, err := readCSVRows(file)
		if err != nil {
			log.Printf("Failed to read CSV %s: %v", file, err)
			continue
		}

		if len(rows) < 2 {
			continue
		}
		header := rows[0]
		
		nameIdx := findIndex(header, "ResourceName")
		projIdx := findIndex(header, "ProjectID")
		regionIdx := findIndex(header, "Region")
		typeIdx := findIndex(header, "AssetType")
		pathIdx := findIndex(header, "FullResourcePath")

		for i := 1; i < len(rows); i++ {
			row := rows[i]
			resName := row[nameIdx]
			
			// Importance Logic
			importance := "Normal"
			lowerType := strings.ToLower(serviceType)
			if strings.Contains(lowerType, "network") || 
			   strings.Contains(lowerType, "cluster") || 
			   strings.Contains(lowerType, "firewall") ||
			   strings.Contains(lowerType, "vpc") ||
			   strings.Contains(lowerType, "sql") {
				importance = "High"
			}

			lastActivity, isActive := activeResources[resName]
			
			if importance == "High" || isActive {
				if lastActivity == "" {
					lastActivity = "Unknown (Always Important)"
				}
				
				activeByType[serviceType] = append(activeByType[serviceType], UnifiedResource{
					ResourceName: resName,
					ProjectID:    row[projIdx],
					Region:       row[regionIdx],
					Importance:   importance,
					LastActivity: lastActivity,
					AssetType:    row[typeIdx],
					ResourcePath: row[pathIdx],
				})
			}
		}
	}

	// 3. Write separate CSVs for each active resource type
	for serviceType, data := range activeByType {
		fileName := filepath.Join(activeSubDir, fmt.Sprintf("%s.csv", serviceType))
		if err := writeActiveCSV(fileName, data); err != nil {
			log.Printf("Failed to write active CSV %s: %v", fileName, err)
		}
	}

	return nil
}

func (s *FilterService) getActiveResourcesFromLogs(ctx context.Context) (map[string]string, error) {
	active := make(map[string]string)
	oneMonthAgo := time.Now().AddDate(0, -1, 0).Format(time.RFC3339)
	filter := fmt.Sprintf("timestamp >= %q AND (protoPayload.resourceName:* OR protoPayload.methodName:*)", oneMonthAgo)
	
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

func findIndex(header []string, col string) int {
	for i, h := range header {
		if h == col {
			return i
		}
	}
	return 0
}

func writeActiveCSV(fileName string, data []UnifiedResource) error {
	file, err := os.Create(fileName)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	writer.Write([]string{"ResourceName", "ProjectID", "Region", "Importance", "LastActivity", "AssetType", "FullResourcePath"})
	for _, res := range data {
		writer.Write([]string{
			res.ResourceName,
			res.ProjectID,
			res.Region,
			res.Importance,
			res.LastActivity,
			res.AssetType,
			res.ResourcePath,
		})
	}
	return nil
}
