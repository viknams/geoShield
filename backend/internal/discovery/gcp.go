package discovery

import (
	"context"
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	asset "cloud.google.com/go/asset/apiv1"
	"cloud.google.com/go/asset/apiv1/assetpb"
	"google.golang.org/api/iterator"
)

type DiscoveryService struct {
	client    *asset.Client
	ProjectID string
}

func NewDiscoveryService(ctx context.Context, projectID string) (*DiscoveryService, error) {
	client, err := asset.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create asset client: %w", err)
	}
	return &DiscoveryService{client: client, ProjectID: projectID}, nil
}

func (s *DiscoveryService) Discover(ctx context.Context, outputDir string) error {
	req := &assetpb.ListAssetsRequest{
		Parent:      fmt.Sprintf("projects/%s", s.ProjectID),
		ContentType: assetpb.ContentType_RESOURCE,
		AssetTypes: []string{
			"compute.googleapis.com/Network",
			"storage.googleapis.com/Bucket",
			"compute.googleapis.com/Instance",
			"container.googleapis.com/Cluster",
			"sqladmin.googleapis.com/Instance",
			"compute.googleapis.com/ForwardingRule",
		},
	}

	it := s.client.ListAssets(ctx, req)
	
	// Map to hold discovered resources by type
	discovered := make(map[string][][]string)

	for {
		resp, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return fmt.Errorf("error iterating assets: %w", err)
		}

		assetName := resp.Name
		assetType := resp.AssetType
		
		// Map asset type to our CSV filename and extract info
		switch assetType {
		case "compute.googleapis.com/Network":
			name := extractName(assetName)
			discovered["vpc"] = append(discovered["vpc"], []string{name, s.ProjectID, name, "me-central1", "subnet-1:me-central1:10.0.1.0/24", "v34.1.0"})
		
		case "storage.googleapis.com/Bucket":
			name := extractName(assetName)
			discovered["gcs"] = append(discovered["gcs"], []string{name, s.ProjectID, "me-central1", name, "me-central1", "true", "v34.1.0"})
		
		case "compute.googleapis.com/Instance":
			name := extractName(assetName)
			discovered["compute-vm"] = append(discovered["compute-vm"], []string{name, s.ProjectID, "me-central1", name, "me-central1-a", "default", "default", "e2-medium", "debian-cloud/debian-11", "v34.1.0"})
		
		case "container.googleapis.com/Cluster":
			name := extractName(assetName)
			discovered["gke-cluster"] = append(discovered["gke-cluster"], []string{name, s.ProjectID, "me-central1", name, "default", "default", "v34.1.0"})
		
		case "sqladmin.googleapis.com/Instance":
			name := extractName(assetName)
			discovered["cloudsql-instance"] = append(discovered["cloudsql-instance"], []string{name, s.ProjectID, "me-central1", name, "default", "POSTGRES_14", "db-f1-micro", "v34.1.0"})
		
		case "compute.googleapis.com/ForwardingRule":
			name := extractName(assetName)
			discovered["net-lb-app-ext"] = append(discovered["net-lb-app-ext"], []string{name, s.ProjectID, "me-central1", name, "v34.1.0"})
		}
	}

	// Write discovery results to CSV files
	for service, rows := range discovered {
		fileName := filepath.Join(outputDir, fmt.Sprintf("%s.csv", service))
		if err := writeCSV(fileName, service, rows); err != nil {
			return err
		}
	}

	return nil
}

func extractName(assetPath string) string {
	parts := strings.Split(assetPath, "/")
	return parts[len(parts)-1]
}

func writeCSV(fileName, service string, rows [][]string) error {
	file, err := os.Create(fileName)
	if err != nil {
		return fmt.Errorf("failed to create CSV file %s: %w", fileName, err)
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	// Define headers based on service
	var header []string
	switch service {
	case "vpc":
		header = []string{"ResourceName", "ProjectID", "NetworkName", "Region", "Subnets", "FastRef"}
	case "gcs":
		header = []string{"ResourceName", "ProjectID", "Region", "BucketName", "Location", "Versioning", "FastRef"}
	case "compute-vm":
		header = []string{"ResourceName", "ProjectID", "Region", "InstanceName", "Zone", "Network", "Subnetwork", "MachineType", "Image", "FastRef"}
	case "gke-cluster":
		header = []string{"ResourceName", "ProjectID", "Region", "ClusterName", "Network", "Subnetwork", "FastRef"}
	case "cloudsql-instance":
		header = []string{"ResourceName", "ProjectID", "Region", "DBName", "Network", "DBVersion", "Tier", "FastRef"}
	case "net-lb-app-ext":
		header = []string{"ResourceName", "ProjectID", "Region", "LBName", "FastRef"}
	}

	if err := writer.Write(header); err != nil {
		return err
	}
	return writer.WriteAll(rows)
}
