package main

import (
	"encoding/csv"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"example.com/geoShield/backend/internal/generator"
)

type VPCData struct {
	ProjectID   string
	NetworkName string
	Region      string
	FastRef     string
	Subnets     []Subnet
}

type Subnet struct {
	Name   string
	Region string
	CIDR   string
}

type GCSData struct {
	ProjectID  string
	Region     string
	BucketName string
	Location   string
	Versioning bool
	FastRef    string
}

type VMData struct {
	ProjectID    string
	Region       string
	InstanceName string
	Zone         string
	Network      string
	Subnetwork   string
	MachineType  string
	Image        string
	FastRef      string
}

type GKEData struct {
	ProjectID   string
	Region      string
	ClusterName string
	Network     string
	Subnetwork  string
	FastRef     string
}

type SQLData struct {
	ProjectID  string
	Region     string
	DBName     string
	Network    string
	DBVersion  string
	Tier       string
	FastRef    string
}

type LBData struct {
	ProjectID string
	Region    string
	LBName    string
	FastRef   string
}

func main() {
	cwd, _ := os.Getwd()
	templateDir := filepath.Join(cwd, "backend", "templates")
	dataDir := filepath.Join(cwd, "data", "gcp")
	outputDir := filepath.Join(cwd, "output")

	gen := generator.New(templateDir)

	// 1. Read consolidated CSV
	activeFile := filepath.Join(dataDir, "active_important_resources.csv")
	rows, err := readCSV(activeFile)
	if err != nil {
		log.Fatalf("failed to read active resources: %v", err)
	}

	config := generator.Config{
		Cloud:       "gcp",
		OrgName:     "wayfair",
		FolderName:  "vikram-gcp-resources",
		ProjectName: "wayfair-test-378605",
		PathPattern: "{{.FolderName}}/{{.Type}}/{{.Name}}",
	}

	// 2. Map back to full data
	for i := 1; i < len(rows); i++ {
		serviceType := rows[i][0]
		resName := rows[i][1]

		serviceCSV := filepath.Join(dataDir, fmt.Sprintf("%s.csv", serviceType))
		serviceRows, err := readCSV(serviceCSV)
		if err != nil {
			log.Printf("Warning: failed to read %s: %v", serviceCSV, err)
			continue
		}

		resData, err := mapResourceData(serviceType, resName, serviceRows)
		if err != nil {
			log.Printf("Warning: %v", err)
			continue
		}

		// --- CODE LEVEL LOGIC FOR VPC wf-vpc-dev ---
		if serviceType == "vpc" && resName == "wf-vpc-dev" {
			if vpc, ok := resData.(VPCData); ok {
				// Re-initialize subnets with actual discovery data provided by user
				vpc.Subnets = []Subnet{
					{Name: "us-east4-sub", Region: "us-east4", CIDR: "10.1.5.0/26"},
					{Name: "wf-dsm-us-east1", Region: "us-east1", CIDR: "10.1.1.0/26"},
					{Name: "wf-dsm-us-east1-sec", Region: "us-east1", CIDR: "10.2.1.0/26"},
					{Name: "wf-dsm-us-west1", Region: "us-west1", CIDR: "10.1.2.0/26"},
					// Inject the new Delhi Subnet
					{Name: "subnet-delhi", Region: "asia-south2", CIDR: "10.1.10.0/26"},
				}
				resData = vpc
			}
		}
		// --- END CODE LEVEL LOGIC ---

		config.Resources = append(config.Resources, generator.Resource{
			Type: serviceType,
			Name: resName,
			Data: resData,
		})
	}

	// 3. Generate Terraform
	log.Printf("Generating Terraform for %d resources...", len(config.Resources))
	_, err = gen.Generate(config, outputDir)
	if err != nil {
		log.Fatalf("failed to generate code: %v", err)
	}

	log.Printf("Terraform code generated successfully in %s/%s", outputDir, config.FolderName)
}

func readCSV(fileName string) ([][]string, error) {
	file, err := os.Open(fileName)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return csv.NewReader(file).ReadAll()
}

func mapResourceData(serviceType, resName string, rows [][]string) (interface{}, error) {
	header := rows[0]
	var row []string
	found := false
	for i := 1; i < len(rows); i++ {
		if rows[i][0] == resName {
			row = rows[i]
			found = true
			break
		}
	}

	if !found {
		return nil, fmt.Errorf("resource %s not found in service CSV", resName)
	}

	m := make(map[string]string)
	for i, h := range header {
		m[h] = row[i]
	}

	switch serviceType {
	case "vpc":
		subnetsStr := m["Subnets"]
		var subnets []Subnet
		for _, s := range strings.Split(subnetsStr, ";") {
			parts := strings.Split(s, ":")
			if len(parts) == 3 {
				subnets = append(subnets, Subnet{parts[0], parts[1], parts[2]})
			}
		}
		return VPCData{m["ProjectID"], m["NetworkName"], m["Region"], m["FastRef"], subnets}, nil

	case "gcs":
		return GCSData{m["ProjectID"], m["Region"], m["BucketName"], m["Location"], m["Versioning"] == "true", m["FastRef"]}, nil

	case "compute-vm":
		return VMData{m["ProjectID"], m["Region"], m["InstanceName"], m["Zone"], m["Network"], m["Subnetwork"], m["MachineType"], m["Image"], m["FastRef"]}, nil

	case "gke-cluster":
		return GKEData{m["ProjectID"], m["Region"], m["ClusterName"], m["Network"], m["Subnetwork"], m["FastRef"]}, nil

	case "cloudsql-instance":
		return SQLData{m["ProjectID"], m["Region"], m["DBName"], m["Network"], m["DBVersion"], m["Tier"], m["FastRef"]}, nil

	case "net-lb-app-ext":
		return LBData{m["ProjectID"], m["Region"], m["LBName"], m["FastRef"]}, nil
	}

	return nil, fmt.Errorf("unsupported service type: %s", serviceType)
}
