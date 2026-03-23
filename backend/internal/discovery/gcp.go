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
	"google.golang.org/api/impersonate"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

type DiscoveryService struct {
	client    *asset.Client
	ProjectID string
}

func NewDiscoveryService(ctx context.Context, projectID string, impersonateEmail string, saJSON string) (*DiscoveryService, error) {
	var opts []option.ClientOption

	if saJSON != "" {
		opts = append(opts, option.WithCredentialsJSON([]byte(saJSON)))
	}

	if impersonateEmail != "" {
		ts, err := impersonate.CredentialsTokenSource(ctx, impersonate.CredentialsConfig{
			TargetPrincipal: impersonateEmail,
			Scopes:          []string{"https://www.googleapis.com/auth/cloud-platform"},
		}, opts...) // Use existing opts (like SA credentials) to impersonate
		if err != nil {
			return nil, fmt.Errorf("failed to create impersonated token source: %w", err)
		}
		opts = append(opts, option.WithTokenSource(ts))
	}

	client, err := asset.NewClient(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create asset client: %w", err)
	}
	return &DiscoveryService{client: client, ProjectID: projectID}, nil
}

func (s *DiscoveryService) Discover(ctx context.Context, outputDir string) error {
	req := &assetpb.ListAssetsRequest{
		Parent:      fmt.Sprintf("projects/%s", s.ProjectID),
		ContentType: assetpb.ContentType_RESOURCE,
		// No AssetTypes filter = Discover All
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
		
		// Generic extraction
		name := extractName(assetName)
		region := "global"
		if resp.Resource != nil && resp.Resource.Location != "" {
			region = resp.Resource.Location
		}

		// Create a sanitized filename key from asset type (e.g., compute.Network)
		typeKey := strings.ReplaceAll(strings.TrimPrefix(assetType, "google.cloud."), "/", ".")
		typeKey = strings.ReplaceAll(typeKey, ".googleapis.com", "")
		
		// Generic Row: ResourceName, AssetType, ProjectID, Region, FullResourcePath
		row := []string{name, assetType, s.ProjectID, region, assetName}
		discovered[typeKey] = append(discovered[typeKey], row)
	}

	// Write discovery results to CSV files
	for typeKey, rows := range discovered {
		fileName := filepath.Join(outputDir, fmt.Sprintf("%s.csv", typeKey))
		if err := writeCSV(fileName, typeKey, rows); err != nil {
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

	// Unified Generic Header
	header := []string{"ResourceName", "AssetType", "ProjectID", "Region", "FullResourcePath"}

	if err := writer.Write(header); err != nil {
		return err
	}
	return writer.WriteAll(rows)
}
