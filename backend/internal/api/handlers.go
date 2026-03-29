package api

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"cloud.google.com/go/storage"
	"google.golang.org/api/iterator"

	"example.com/geoShield/backend/internal/discovery"
	"example.com/geoShield/backend/internal/generator"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type APIHandler struct {
	DiscoverySvc              *discovery.DiscoveryService
	FilterSvc                 *discovery.FilterService
	GenSvc                    *generator.Generator
	DataDir                   string
	OutputDir                 string
	ImpersonateEmail          string
	ServiceAccountJSON        string
	TerraformStateBucket      string
	TerraformCloud            string
	TerraformOrgName          string
	TerraformFolderName       string
	TerraformCriticalResource string

	// Track auth status
	mu         sync.RWMutex
	authStatus string
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

	// Check for environment-based authentication
	// 1. K_SERVICE: Set by Cloud Run (uses Metadata Server)
	// 2. GOOGLE_APPLICATION_CREDENTIALS: Standard ADC file path
	// 3. ServiceAccountJSON: Custom JSON content
	if os.Getenv("K_SERVICE") != "" || os.Getenv("GOOGLE_APPLICATION_CREDENTIALS") != "" || h.ServiceAccountJSON != "" {
		h.authStatus = "Completed"
		log.Printf("Detected environment-based authentication (Cloud Run Metadata, ADC, or JSON). Browser login skipped.")
		c.JSON(http.StatusOK, gin.H{
			"status": "Authenticated via environment. Browser login skipped.",
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

	// Construct the correct, project-specific path for discovery output
	projectDataDir := strings.Replace(h.DataDir, "GCP_PROJECT", projectID, 1)
	log.Printf("DiscoverGCP: Using data directory: %s", projectDataDir)
	if err := svc.Discover(ctx, projectDataDir); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("discovery failed: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "Discovery completed. CSV files updated."})
}

func (h *APIHandler) ListResources(c *gin.Context) {
	projectID := c.Query("project")
	if projectID == "" {
		// If no project is specified, we can't list resources.
		c.JSON(http.StatusOK, make(map[string][][]string))
		return
	}

	projectDataDir := strings.Replace(h.DataDir, "GCP_PROJECT", projectID, 1)
	log.Printf("ListResources: Using data directory: %s", projectDataDir)
	// Ensure the directory exists to prevent silent failures if discovery hasn't run.
	if _, err := os.Stat(projectDataDir); os.IsNotExist(err) {
		log.Printf("Discovery data directory does not exist, creating: %s", projectDataDir)
		os.MkdirAll(projectDataDir, 0755)
	}

	files, _ := filepath.Glob(filepath.Join(projectDataDir, "*.csv"))

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

	// Construct the correct, project-specific path for filtering
	projectDataDir := strings.Replace(h.DataDir, "GCP_PROJECT", projectID, 1)
	log.Printf("FilterGCP: Using data directory: %s", projectDataDir)
	if err := svc.FilterAndConsolidate(ctx, projectDataDir); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("filtering failed: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "Filtering completed. active_important_resources.csv updated."})
}

func (h *APIHandler) ListActiveResources(c *gin.Context) {
	projectID := c.Query("project")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project ID is required"})
		return
	}

	// Construct the correct, project-specific path
	projectDataDir := strings.Replace(h.DataDir, "GCP_PROJECT", projectID, 1)
	log.Printf("ListActiveResources: Using data directory: %s", projectDataDir)
	activeDir := filepath.Join(projectDataDir, h.TerraformCriticalResource)
	log.Printf("ListActiveResources: Looking for active resources in: %s", activeDir)

	// Ensure the directory exists to prevent silent failures.
	if _, err := os.Stat(activeDir); os.IsNotExist(err) {
		log.Printf("Active resources directory does not exist, creating: %s", activeDir)
		os.MkdirAll(activeDir, 0755)
	}

	result := make(map[string][][]string)
	files, _ := filepath.Glob(filepath.Join(activeDir, "*.csv"))

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

func (h *APIHandler) ListManagedResources(c *gin.Context) {
	ctx := context.Background()
	client, err := storage.NewClient(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to create storage client: %v", err)})
		return
	}
	defer client.Close()

	bucket := client.Bucket(h.TerraformStateBucket)
	query := &storage.Query{Prefix: h.TerraformFolderName + "/"}

	managedResources := make(map[string][][]string)
	it := bucket.Objects(ctx, query)
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to iterate bucket objects: %v", err)})
			return
		}

		// Path is like: all-resources/gcs/mg-my-bucket/default.tfstate
		// We want to extract "gcs" and "mg-my-bucket"
		parts := strings.Split(attrs.Name, "/")
		if len(parts) >= 3 {
			serviceType := parts[1]
			resourceName := parts[2]

			// Use the original name for display
			displayName := strings.TrimPrefix(resourceName, "mg-")

			if _, ok := managedResources[serviceType]; !ok {
				// Create header
				managedResources[serviceType] = [][]string{{"ResourceName", "Terraform Name", "ServiceType"}}
			}
			managedResources[serviceType] = append(managedResources[serviceType], []string{displayName, resourceName, serviceType})
		}
	}

	log.Printf("Found %d types of managed resources in state bucket.", len(managedResources))
	c.JSON(http.StatusOK, managedResources)
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
	ProjectID string
	Region    string
	DBName    string
	Network   string
	DBVersion string
	Tier      string
	FastRef   string
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

type PlanPayload struct {
	Resources   map[string][][]string `json:"resources"`
	WorkspaceID string                `json:"workspaceId"`
}

func (h *APIHandler) PlanTerraform(c *gin.Context) {
	var payload PlanPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		// Log the raw body for debugging if JSON binding fails
		bodyBytes, _ := io.ReadAll(c.Request.Body)
		log.Printf("Failed to bind JSON payload for plan. Error: %v. Raw body: %s", err, string(bodyBytes))
		c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes)) // Restore the body
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload", "details": err.Error()})
		return
	}

	log.Printf("Successfully received and parsed plan payload for %d resource types.", len(payload.Resources))
	projectID := c.Query("project")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project ID is required"})
		return
	}

	// --- Start: Ephemeral Workspace ---
	runID := uuid.New().String()
	workspaceDir := filepath.Join(h.OutputDir, "run-"+runID)
	log.Printf("Creating ephemeral workspace: %s", workspaceDir)

	config := generator.Config{
		Cloud:       h.TerraformCloud,
		OrgName:     h.TerraformOrgName,
		FolderName:  h.TerraformFolderName,
		ProjectName: projectID,
		// PathPattern now generates inside the unique workspace
		PathPattern:          "{{.FolderName}}/{{.Type}}/{{.Name}}",
		TerraformStateBucket: h.TerraformStateBucket,
	}

	for serviceType, rows := range payload.Resources {
		if len(rows) < 2 {
			continue // malformed payload for serviceType
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
	_, err := h.GenSvc.Generate(config, workspaceDir) // Generate into the unique workspace dir
	if err != nil {
		log.Printf("Error generating terraform code: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to generate code: %v", err)})
		return
	}

	var combinedOutput string
	for i, res := range config.Resources {
		// Path is now inside the unique workspace
		path := filepath.Join(workspaceDir, config.FolderName, res.Type, res.Name)

		displayType := res.Type
		if displayType == "fallback" {
			if fbData, ok := res.Data.(FallbackData); ok {
				displayType = fbData.ServiceType
			} else {
				displayType = "generic-resource"
			}
		}

		log.Printf("[%d/%d] Initializing Terraform for %s: %s", i+1, len(config.Resources), displayType, res.Name)

		prefix := filepath.Join(config.FolderName, res.Type, res.Name)
		initCmd := exec.Command("terraform", "init", "-no-color",
			fmt.Sprintf("-backend-config=bucket=%s", config.TerraformStateBucket),
			fmt.Sprintf("-backend-config=prefix=%s", prefix),
		)
		initCmd.Dir = path
		initOutput, err := initCmd.CombinedOutput()
		if err != nil {
			log.Printf("-> Terraform init failed for %s: %v", res.Name, err)
			combinedOutput += fmt.Sprintf("=== Init Error for %s: %s ===\n%s\n", displayType, res.Name, string(initOutput))
			continue
		}

		// --- Start: Plan File Workflow ---
		log.Printf("[%d/%d] Generating Terraform plan file for %s: %s", i+1, len(config.Resources), displayType, res.Name)
		planFilePath := filepath.Join(path, "terraform.tfplan")
		planCmd := exec.Command("terraform", "plan", "-no-color", "-out="+planFilePath)
		planCmd.Dir = path
		planOutput, err := planCmd.CombinedOutput()
		if err != nil {
			log.Printf("-> Terraform plan failed for %s: %v", res.Name, err)
			combinedOutput += fmt.Sprintf("=== Plan Error for %s: %s ===\n%s\n", displayType, res.Name, string(planOutput))
			continue
		}

		log.Printf("[%d/%d] Showing Terraform plan for %s: %s", i+1, len(config.Resources), displayType, res.Name)
		showCmd := exec.Command("terraform", "show", "-no-color", planFilePath)
		showCmd.Dir = path
		showOutput, err := showCmd.CombinedOutput()
		if err != nil {
			log.Printf("-> Terraform show failed for %s: %v", res.Name, err)
			combinedOutput += fmt.Sprintf("=== Show Plan Error for %s: %s ===\n%s\n", displayType, res.Name, string(showOutput))
			continue
		}
		// --- End: Plan File Workflow ---

		combinedOutput += fmt.Sprintf("=== Plan for %s: %s ===\n%s\n", displayType, res.Name, string(showOutput))
	}

	if len(config.Resources) == 0 {
		combinedOutput = "No supported resources selected for planning. Ensure selected resources are supported by templates."
	}

	log.Printf("Completed planning for %d resources.", len(config.Resources))
	c.JSON(http.StatusOK, gin.H{
		"plan_output": combinedOutput,
		"workspaceId": runID, // Send workspace ID to frontend
	})
}

type ApplyPayload struct {
	Resources   map[string][][]string `json:"resources"`
	WorkspaceID string                `json:"workspaceId"`
}

func (h *APIHandler) ApplyTerraform(c *gin.Context) {
	var payload ApplyPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	if payload.WorkspaceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "workspaceId is required for apply"})
		return
	}

	// --- Start: Use Existing Workspace ---
	workspaceDir := filepath.Join(h.OutputDir, "run-"+payload.WorkspaceID)
	log.Printf("Using existing workspace for apply: %s", workspaceDir)
	if _, err := os.Stat(workspaceDir); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Workspace not found. It may have expired or been deleted. Please generate a new plan."})
		return
	}

	// Defer cleanup to ensure workspace is always removed
	defer func() {
		log.Printf("Cleaning up ephemeral workspace for apply: %s", workspaceDir)
		os.RemoveAll(workspaceDir)
	}()
	// --- End: Ephemeral Workspace ---

	projectID := c.Query("project")

	config := generator.Config{
		Cloud:       h.TerraformCloud,
		OrgName:     h.TerraformOrgName,
		FolderName:  h.TerraformFolderName,
		ProjectName: projectID,
		// PathPattern now generates inside the unique workspace
		PathPattern:          "{{.FolderName}}/{{.Type}}/{{.Name}}",
		TerraformStateBucket: h.TerraformStateBucket,
	}

	for serviceType, rows := range payload.Resources {
		if len(rows) < 2 {
			continue // malformed payload for serviceType
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

	var combinedOutput string
	for i, res := range config.Resources {
		// Path is now inside the unique workspace
		path := filepath.Join(workspaceDir, config.FolderName, res.Type, res.Name)

		displayType := res.Type
		if displayType == "fallback" {
			if fbData, ok := res.Data.(FallbackData); ok {
				displayType = fbData.ServiceType
			} else {
				displayType = "generic-resource"
			}
		}

		// --- Start: Apply Saved Plan File ---
		planFilePath := filepath.Join(path, "terraform.tfplan")
		log.Printf("[%d/%d] Applying Terraform plan for %s: %s", i+1, len(config.Resources), displayType, res.Name)
		applyCmd := exec.Command("terraform", "apply", "-no-color", planFilePath)
		applyCmd.Dir = path
		output, err := applyCmd.CombinedOutput()

		combinedOutput += fmt.Sprintf("=== Apply for %s: %s ===\n%s\n", displayType, res.Name, string(output))
		if err != nil {
			log.Printf("-> Terraform apply failed for %s: %v", res.Name, err)
		}

	}

	if len(config.Resources) == 0 {
		combinedOutput = "No supported resources selected for applying."
	}

	log.Printf("Completed applying for %d resources.", len(config.Resources))
	c.JSON(http.StatusOK, gin.H{"apply_output": combinedOutput})
}

type DestroyPayload struct {
	Resources map[string][][]string `json:"resources"`
}

func (h *APIHandler) DestroyTerraform(c *gin.Context) {
	var payload DestroyPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	projectID := c.Query("project")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project ID is required"})
		return
	}

	// --- Start: Ephemeral Workspace ---
	runID := uuid.New().String()
	workspaceDir := filepath.Join(h.OutputDir, "run-"+runID)
	log.Printf("Creating ephemeral workspace for destroy: %s", workspaceDir)
	// Defer cleanup to ensure workspace is always removed
	defer func() {
		log.Printf("Cleaning up ephemeral workspace for destroy: %s", workspaceDir)
		os.RemoveAll(workspaceDir)
	}()
	// --- End: Ephemeral Workspace ---

	config := generator.Config{
		Cloud:                h.TerraformCloud,
		OrgName:              h.TerraformOrgName,
		FolderName:           h.TerraformFolderName,
		ProjectName:          projectID,
		PathPattern:          "{{.FolderName}}/{{.Type}}/{{.Name}}",
		TerraformStateBucket: h.TerraformStateBucket,
	}

	for serviceType, rows := range payload.Resources {
		if len(rows) < 2 {
			continue // malformed payload for serviceType
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

	log.Printf("Generating Terraform for %d resources before destroying...", len(config.Resources))
	_, err := h.GenSvc.Generate(config, workspaceDir)
	if err != nil {
		log.Printf("Error generating terraform code: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to generate code: %v", err)})
		return
	}

	var combinedOutput string
	for i, res := range config.Resources {
		path := filepath.Join(workspaceDir, config.FolderName, res.Type, res.Name)

		displayType := res.Type
		if fbData, ok := res.Data.(FallbackData); ok {
			displayType = fbData.ServiceType
		}

		log.Printf("[%d/%d] Initializing Terraform for %s: %s", i+1, len(config.Resources), displayType, res.Name)
		prefix := filepath.Join(config.FolderName, res.Type, res.Name)
		initCmd := exec.Command("terraform", "init", "-no-color",
			fmt.Sprintf("-backend-config=bucket=%s", config.TerraformStateBucket),
			fmt.Sprintf("-backend-config=prefix=%s", prefix),
		)
		initCmd.Dir = path
		initOutput, err := initCmd.CombinedOutput()
		if err != nil {
			log.Printf("-> Terraform init failed for %s: %v", res.Name, err)
			combinedOutput += fmt.Sprintf("=== Init Error for %s: %s ===\n%s\n", displayType, res.Name, string(initOutput))
			continue
		}

		log.Printf("[%d/%d] Destroying Terraform for %s: %s", i+1, len(config.Resources), displayType, res.Name)
		destroyCmd := exec.Command("terraform", "destroy", "-auto-approve", "-no-color")
		destroyCmd.Dir = path
		output, err := destroyCmd.CombinedOutput()

		combinedOutput += fmt.Sprintf("=== Destroy for %s: %s ===\n%s\n", displayType, res.Name, string(output))
		if err != nil {
			log.Printf("-> Terraform destroy failed for %s: %v", res.Name, err)
		}
	}

	if len(config.Resources) == 0 {
		combinedOutput = "No supported resources selected for destroying."
	}

	log.Printf("Completed destroying for %d resources.", len(config.Resources))
	c.JSON(http.StatusOK, gin.H{"destroy_output": combinedOutput})
}
