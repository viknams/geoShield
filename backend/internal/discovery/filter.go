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
	"google.golang.org/api/iterator"
)

type FilterService struct {
	adminClient *logadmin.Client
	ProjectID   string
}

func NewFilterService(ctx context.Context, projectID string) (*FilterService, error) {
	adminClient, err := logadmin.NewClient(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to create logadmin client: %w", err)
	}
	return &FilterService{adminClient: adminClient, ProjectID: projectID}, nil
}

type UnifiedResource struct {
	ServiceType  string
	ResourceName string
	ProjectID    string
	Region       string
	Importance   string
	LastActivity string
}

func (s *FilterService) FilterAndConsolidate(ctx context.Context, dataDir string) error {
	// 1. Get active resource names from logs in the last 30 days
	activeResources, err := s.getActiveResourcesFromLogs(ctx)
	if err != nil {
		log.Printf("[WARNING] Could not fetch logs for usage verification: %v. Falling back to foundation-only filtering.", err)
		activeResources = make(map[string]string) // Empty map if logging fail
	}

	var consolidated []UnifiedResource

	// 2. Read all CSV files in the data directory
	files, _ := filepath.Glob(filepath.Join(dataDir, "*.csv"))
	for _, file := range files {
		// Skip our output file if it already exists
		if strings.HasSuffix(file, "active_important_resources.csv") {
			continue
		}

		serviceType := strings.TrimSuffix(filepath.Base(file), ".csv")
		rows, err := readCSVRows(file)
		if err != nil {
			log.Printf("Failed to read CSV %s: %v", file, err)
			continue
		}

		// Header is the first row
		if len(rows) < 2 {
			continue
		}
		header := rows[0]
		
		// Find indexes for Name, Project, Region
		nameIdx := findIndex(header, "ResourceName")
		projIdx := findIndex(header, "ProjectID")
		regionIdx := findIndex(header, "Region")

		for i := 1; i < len(rows); i++ {
			row := rows[i]
			resName := row[nameIdx]
			
			// Importance Logic
			importance := "Normal"
			if serviceType == "vpc" || serviceType == "gke-cluster" {
				importance = "High"
			}

			// Usage Logic: Is it in the logs?
			lastActivity, isActive := activeResources[resName]
			
			// Filter: High Importance (always) OR Active (last 1 month)
			if importance == "High" || isActive {
				if lastActivity == "" {
					lastActivity = "Unknown (Always Important)"
				}
				
				consolidated = append(consolidated, UnifiedResource{
					ServiceType:  serviceType,
					ResourceName: resName,
					ProjectID:    row[projIdx],
					Region:       row[regionIdx],
					Importance:   importance,
					LastActivity: lastActivity,
				})
			}
		}
	}

	// 3. Write to the new single CSV file
	return writeUnifiedCSV(filepath.Join(dataDir, "active_important_resources.csv"), consolidated)
}

func (s *FilterService) getActiveResourcesFromLogs(ctx context.Context) (map[string]string, error) {
	active := make(map[string]string)
	
	// Query logs from the last 30 days
	oneMonthAgo := time.Now().AddDate(0, -1, 0).Format(time.RFC3339)
	filter := fmt.Sprintf("timestamp >= %q AND (protoPayload.metadata.name:* OR protoPayload.resourceName:*)", oneMonthAgo)
	
	it := s.adminClient.Entries(ctx, logadmin.Filter(filter))
	for {
		entry, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}

		// Try to extract resource name from entry
		resName := ""
		if entry.Resource != nil && entry.Resource.Labels != nil {
			if name, ok := entry.Resource.Labels["instance_id"]; ok { resName = name }
			if name, ok := entry.Resource.Labels["name"]; ok { resName = name }
			if name, ok := entry.Resource.Labels["bucket_name"]; ok { resName = name }
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

func writeUnifiedCSV(fileName string, data []UnifiedResource) error {
	file, err := os.Create(fileName)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	writer.Write([]string{"ServiceType", "ResourceName", "ProjectID", "Region", "Importance", "LastActivity"})
	for _, res := range data {
		writer.Write([]string{
			res.ServiceType,
			res.ResourceName,
			res.ProjectID,
			res.Region,
			res.Importance,
			res.LastActivity,
		})
	}
	return nil
}
