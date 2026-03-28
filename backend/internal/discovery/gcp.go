package discovery

import (
	"context"
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	asset "cloud.google.com/go/asset/apiv1"
	"cloud.google.com/go/asset/apiv1/assetpb"
	"google.golang.org/api/impersonate"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
	"google.golang.org/protobuf/types/known/structpb"
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

type discoveryData struct {
	header []string
	rows   [][]string
}

func (s *DiscoveryService) Discover(ctx context.Context, outputDir string) error {
	req := &assetpb.ListAssetsRequest{
		Parent:      fmt.Sprintf("projects/%s", s.ProjectID),
		ContentType: assetpb.ContentType_RESOURCE,
	}

	it := s.client.ListAssets(ctx, req)

	discovered := make(map[string]*discoveryData)

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
		name := extractName(assetName)
		region := "global"
		if resp.Resource != nil && resp.Resource.Location != "" {
			region = resp.Resource.Location
		}

		typeKey := strings.ReplaceAll(strings.TrimPrefix(assetType, "google.cloud."), "/", ".")
		typeKey = strings.ReplaceAll(typeKey, ".googleapis.com", "")

		if resp.Resource == nil || resp.Resource.Data == nil {
			continue
		}

		data, ok := discovered[typeKey]
		if !ok {
			specificHeader := extractHeader(resp.Resource.Data)
			header := append([]string{"ResourceName", "AssetType", "ProjectID", "Region", "FullResourcePath"}, specificHeader...)
			data = &discoveryData{header: header}
			discovered[typeKey] = data
		}

		specificRow := extractRow(resp.Resource.Data, data.header[5:])
		genericRow := []string{name, assetType, s.ProjectID, region, assetName}
		row := append(genericRow, specificRow...)
		data.rows = append(data.rows, row)
	}

	for typeKey, data := range discovered {
		fileName := filepath.Join(outputDir, fmt.Sprintf("%s.csv", typeKey))
		if err := writeCSV(fileName, data.header, data.rows); err != nil {
			return err
		}
	}

	return nil
}

func extractName(assetPath string) string {
	parts := strings.Split(assetPath, "/")
	return parts[len(parts)-1]
}

func extractHeader(data *structpb.Struct) []string {
	header := make([]string, 0, len(data.Fields))
	for key := range data.Fields {
		header = append(header, key)
	}
	sort.Strings(header) // Sort for consistent column order
	return header
}

func extractRow(data *structpb.Struct, header []string) []string {
	row := make([]string, len(header))
	for i, key := range header {
		if val, ok := data.Fields[key]; ok {
			row[i] = valueToString(val)
		}
	}
	return row
}

func valueToString(val *structpb.Value) string {
	if val == nil {
		return ""
	}
	switch v := val.Kind.(type) {
	case *structpb.Value_StringValue:
		return v.StringValue
	case *structpb.Value_NumberValue:
		return fmt.Sprintf("%f", v.NumberValue)
	case *structpb.Value_BoolValue:
		return fmt.Sprintf("%t", v.BoolValue)
	case *structpb.Value_NullValue:
		return "null"
	case *structpb.Value_StructValue, *structpb.Value_ListValue:
		bytes, err := val.MarshalJSON()
		if err != nil {
			return "COMPLEX_TYPE_MARSHAL_ERROR"
		}
		return string(bytes)
	default:
		return "UNKNOWN_TYPE"
	}
}

func writeCSV(fileName string, header []string, rows [][]string) error {
	if err := os.MkdirAll(filepath.Dir(fileName), 0755); err != nil {
		return fmt.Errorf("failed to create directory for %s: %w", fileName, err)
	}
	file, err := os.Create(fileName)
	if err != nil {
		return fmt.Errorf("failed to create CSV file %s: %w", fileName, err)
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	if err := writer.Write(header); err != nil {
		return fmt.Errorf("failed to write header to %s: %w", fileName, err)
	}
	return writer.WriteAll(rows)
}
