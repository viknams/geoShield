package api

import (
	"context"
	"encoding/csv"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"example.com/geoShield/backend/internal/discovery"
	"example.com/geoShield/backend/internal/generator"
	"github.com/gin-gonic/gin"
)

type APIHandler struct {
	DiscoverySvc *discovery.DiscoveryService
	FilterSvc    *discovery.FilterService
	GenSvc       *generator.Generator
	DataDir      string
	OutputDir    string
	ImpersonateEmail string
	
	// Track auth status
	mu          sync.RWMutex
	authStatus  string
}

func (h *APIHandler) AuthGCP(c *gin.Context) {
	projectID := c.Query("project")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project ID is required"})
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	if h.ImpersonateEmail != "" {
		h.authStatus = "Completed"
		log.Printf("Impersonation active for %s. Skipping browser login.", h.ImpersonateEmail)
		c.JSON(http.StatusOK, gin.H{
			"status": fmt.Sprintf("Impersonation active for %s. Browser login skipped.", h.ImpersonateEmail),
		})
		return
	}

	h.authStatus = "Pending"

	// Trigger gcloud auth in a separate process
	cmd := exec.Command("gcloud", "auth", "application-default", "login", "--project", projectID)
	
	go func() {
		err := cmd.Run()
		h.mu.Lock()
		defer h.mu.Unlock()
		if err != nil {
			h.authStatus = fmt.Sprintf("Failed: %v", err)
		} else {
			h.authStatus = "Completed"
		}
	}()

	c.JSON(http.StatusOK, gin.H{"status": "Authentication started. Check your browser."})
}

func (h *APIHandler) GetAuthStatus(c *gin.Context) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"status": h.authStatus})
}

func (h *APIHandler) DiscoverGCP(c *gin.Context) {
	projectID := c.Query("project")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project ID is required"})
		return
	}

	ctx := context.Background()
	svc, err := discovery.NewDiscoveryService(ctx, projectID, h.ImpersonateEmail)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to init discovery: %v", err)})
		return
	}

	if err := svc.Discover(ctx, h.DataDir); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("discovery failed: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "Discovery completed. CSV files updated."})
}

func (h *APIHandler) ListResources(c *gin.Context) {
	files, _ := filepath.Glob(filepath.Join(h.DataDir, "*.csv"))
	result := make(map[string][][]string)

	for _, file := range files {
		name := strings.TrimSuffix(filepath.Base(file), ".csv")
		if name == "active_important_resources" {
			continue
		}

		f, err := os.Open(file)
		if err != nil {
			continue
		}
		defer f.Close()

		rows, err := csv.NewReader(f).ReadAll()
		if err == nil {
			result[name] = rows
		}
	}

	c.JSON(http.StatusOK, result)
}

func (h *APIHandler) FilterGCP(c *gin.Context) {
	projectID := c.Query("project")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project ID is required"})
		return
	}

	ctx := context.Background()
	svc, err := discovery.NewFilterService(ctx, projectID, h.ImpersonateEmail)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to init filter: %v", err)})
		return
	}

	if err := svc.FilterAndConsolidate(ctx, h.DataDir); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("filtering failed: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "Filtering completed. active_important_resources.csv updated."})
}

func (h *APIHandler) ListActiveResources(c *gin.Context) {
	activeDir := filepath.Join(h.DataDir, "active-resources")
	files, _ := filepath.Glob(filepath.Join(activeDir, "*.csv"))
	result := make(map[string][][]string)

	for _, file := range files {
		name := strings.TrimSuffix(filepath.Base(file), ".csv")
		
		f, err := os.Open(file)
		if err != nil {
			continue
		}
		defer f.Close()

		rows, err := csv.NewReader(f).ReadAll()
		if err == nil {
			result[name] = rows
		}
	}

	if len(result) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "no active resources found"})
		return
	}

	c.JSON(http.StatusOK, result)
}

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

type FallbackData struct {
	ProjectID   string
	Region      string
	Name        string
	FastRef     string
	ServiceType string
}

func mapFromUnifiedResource(serviceType string, header []string, row []string) (string, interface{}, string) {
	m := make(map[string]string)
	for i, h := range header {
		if i < len(row) {
			m[h] = row[i]
		}
	}
	resName := m["ResourceName"]
	projectID := m["ProjectID"]
	region := m["Region"]
	if region == "" || region == "global" {
		region = "us-east1" // default placeholder
	}
	// Use stable release tag for Fabric modules instead of AssetType
	fastRef := "v34.1.0"

	switch serviceType {
	case "compute.Network":
		var subnets []Subnet
		if resName == "wf-vpc-dev" {
			subnets = []Subnet{
				{Name: "us-east4-sub", Region: "us-east4", CIDR: "10.1.5.0/26"},
				{Name: "wf-dsm-us-east1", Region: "us-east1", CIDR: "10.1.1.0/26"},
				{Name: "wf-dsm-us-east1-sec", Region: "us-east1", CIDR: "10.2.1.0/26"},
				{Name: "wf-dsm-us-west1", Region: "us-west1", CIDR: "10.1.2.0/26"},
				{Name: "subnet-delhi", Region: "asia-south2", CIDR: "10.1.10.0/26"},
			}
		} else {
			subnets = []Subnet{{Name: resName + "-sub", Region: region, CIDR: "10.0.0.0/24"}}
		}
		return "vpc", VPCData{projectID, resName, region, fastRef, subnets}, resName
	case "storage.Bucket":
		return "gcs", GCSData{projectID, region, resName, "US", true, fastRef}, resName
	case "compute.Instance":
		return "compute-vm", VMData{projectID, region, resName, region + "-a", "default", "default", "e2-medium", "debian-cloud/debian-11", fastRef}, resName
	case "container.Cluster":
		return "gke-cluster", GKEData{projectID, region, resName, "default", "default", fastRef}, resName
	case "sqladmin.Instance":
		return "cloudsql-instance", SQLData{projectID, region, resName, "default", "POSTGRES_14", "db-f1-micro", fastRef}, resName
	case "compute.ForwardingRule":
		return "net-lb-app-ext", LBData{projectID, region, resName, fastRef}, resName
	default:
		// Map any other selected resource to the fallback generic module
		return "fallback", FallbackData{projectID, region, resName, fastRef, serviceType}, resName
	}
}

func (h *APIHandler) PlanTerraform(c *gin.Context) {
	var payload map[string][][]string
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	projectID := c.Query("project")
	if projectID == "" {
		projectID = "wayfair-test-378605"
	}

	config := generator.Config{
		Cloud:       "gcp",
		OrgName:     "wayfair",
		FolderName:  "vikram-gcp-resources",
		ProjectName: projectID,
		PathPattern: "{{.FolderName}}/{{.Type}}/{{.Name}}",
	}

	for serviceType, rows := range payload {
		if len(rows) < 2 {
			continue
		}
		header := rows[0]
		for i := 1; i < len(rows); i++ {
			row := rows[i]
			mappedType, resData, resName := mapFromUnifiedResource(serviceType, header, row)
			if mappedType == "" {
				continue // Skip unsupported
			}

			config.Resources = append(config.Resources, generator.Resource{
				Type: mappedType,
				Name: resName,
				Data: resData,
			})
		}
	}

	log.Printf("Generating Terraform for %d resources...", len(config.Resources))
	_, err := h.GenSvc.Generate(config, h.OutputDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to generate code: %v", err)})
		return
	}

	var combinedOutput string
	for _, res := range config.Resources {
		path := filepath.Join(h.OutputDir, config.FolderName, res.Type, res.Name)

		initCmd := exec.Command("terraform", "init", "-no-color")
		initCmd.Dir = path
		initOutput, err := initCmd.CombinedOutput()
		if err != nil {
			combinedOutput += fmt.Sprintf("=== Init Error for %s %s ===\n%s\n", res.Type, res.Name, string(initOutput))
			continue
		}

		planCmd := exec.Command("terraform", "plan", "-no-color")
		planCmd.Dir = path
		output, err := planCmd.CombinedOutput()

		combinedOutput += fmt.Sprintf("=== Plan for %s %s ===\n%s\n", res.Type, res.Name, string(output))
		if err != nil {
			combinedOutput += fmt.Sprintf("Error: %v\n", err)
		}
	}

	if len(config.Resources) == 0 {
		combinedOutput = "No supported resources selected for planning. Ensure selected resources are supported by templates."
	}

	c.JSON(http.StatusOK, gin.H{"plan_output": combinedOutput})
}
