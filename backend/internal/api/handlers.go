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
	ImpersonateEmail   string
	ServiceAccountJSON string
	
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

	impersonate := c.Query("impersonate")
	if impersonate == "" {
		impersonate = h.ImpersonateEmail
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	// Check if already authenticated via ServiceAccountJSON or if we're on Cloud Run (usually doesn't need browser auth)
	if h.ServiceAccountJSON != "" || os.Getenv("K_SERVICE") != "" {
		h.authStatus = "Completed"
		log.Printf("Already authenticated via environment (ServiceAccountJSON or Cloud Run). Skipping browser login.")
		c.JSON(http.StatusOK, gin.H{
			"status": "Already authenticated via environment. Browser login skipped.",
		})
		return
	}

	if impersonate != "" {
		h.authStatus = "Completed"
		log.Printf("Impersonation active for %s. Skipping browser login.", impersonate)
		c.JSON(http.StatusOK, gin.H{
			"status": fmt.Sprintf("Impersonation active for %s. Browser login skipped.", impersonate),
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

	impersonate := c.Query("impersonate")
	if impersonate == "" {
		impersonate = h.ImpersonateEmail
	}

	ctx := context.Background()
	svc, err := discovery.NewDiscoveryService(ctx, projectID, impersonate, h.ServiceAccountJSON)
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

	impersonate := c.Query("impersonate")
	if impersonate == "" {
		impersonate = h.ImpersonateEmail
	}

	ctx := context.Background()
	svc, err := discovery.NewFilterService(ctx, projectID, impersonate, h.ServiceAccountJSON)
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
	
	newResName := "mg-" + resName

	region := m["NewRegion"]
	if region == "" {
		region = m["Region"]
	}
	if region == "" || region == "global" {
		region = "us-east1" // default placeholder
	}
	
	newSubnet := m["NewSubnet"]

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
			cidr := "10.0.0.0/24"
			if newSubnet != "" {
				cidr = newSubnet
			}
			subnets = []Subnet{{Name: newResName + "-sub", Region: region, CIDR: cidr}}
		}
		return "vpc", VPCData{projectID, newResName, region, fastRef, subnets}, newResName
	case "storage.Bucket":
		return "gcs", GCSData{projectID, region, newResName, "US", true, fastRef}, newResName
	case "compute.Instance":
		zone := region + "-a"
		if m["NewRegion"] != "" {
			zone = region + "-a"
		}
		return "compute-vm", VMData{projectID, region, newResName, zone, "default", "default", "e2-medium", "debian-cloud/debian-11", fastRef}, newResName
	case "container.Cluster":
		return "gke-cluster", GKEData{projectID, region, newResName, "default", "default", fastRef}, newResName
	case "sqladmin.Instance":
		return "cloudsql-instance", SQLData{projectID, region, newResName, "default", "POSTGRES_14", "db-f1-micro", fastRef}, newResName
	case "compute.ForwardingRule":
		return "net-lb-app-ext", LBData{projectID, region, newResName, fastRef}, newResName
	default:
		// Map any other selected resource to the fallback generic module
		return "fallback", FallbackData{projectID, region, newResName, fastRef, serviceType}, newResName
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "project ID is required"})
		return
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
		log.Printf("Error generating terraform code: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to generate code: %v", err)})
		return
	}

	var combinedOutput string
	for i, res := range config.Resources {
		path := filepath.Join(h.OutputDir, config.FolderName, res.Type, res.Name)

		displayType := res.Type
		if displayType == "fallback" {
			if fbData, ok := res.Data.(FallbackData); ok {
				displayType = fbData.ServiceType
			} else {
				displayType = "generic-resource"
			}
		}

		log.Printf("[%d/%d] Initializing Terraform for %s: %s", i+1, len(config.Resources), displayType, res.Name)

		initCmd := exec.Command("terraform", "init", "-no-color")
		initCmd.Dir = path
		initOutput, err := initCmd.CombinedOutput()
		if err != nil {
			log.Printf("-> Terraform init failed for %s: %v", res.Name, err)
			combinedOutput += fmt.Sprintf("=== Init Error for %s: %s ===\n%s\n", displayType, res.Name, string(initOutput))
			continue
		}

		log.Printf("[%d/%d] Running Terraform plan for %s: %s", i+1, len(config.Resources), displayType, res.Name)
		planCmd := exec.Command("terraform", "plan", "-no-color")
		planCmd.Dir = path
		output, err := planCmd.CombinedOutput()

		combinedOutput += fmt.Sprintf("=== Plan for %s: %s ===\n%s\n", displayType, res.Name, string(output))
		if err != nil {
			log.Printf("-> Terraform plan failed for %s: %v", res.Name, err)
			combinedOutput += fmt.Sprintf("Error: %v\n", err)
		} else {
			log.Printf("-> Terraform plan succeeded for %s", res.Name)
		}
	}

	if len(config.Resources) == 0 {
		combinedOutput = "No supported resources selected for planning. Ensure selected resources are supported by templates."
	}

	log.Printf("Completed planning for %d resources.", len(config.Resources))
	c.JSON(http.StatusOK, gin.H{"plan_output": combinedOutput})
}
