package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/pubsub"
	"cloud.google.com/go/storage"
	"google.golang.org/api/iterator"

	"example.com/geoShield/backend/internal/discovery"
	"example.com/geoShield/backend/internal/generator"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
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
	ResourcePrefix            string
	TerraformCriticalResource string
	// New fields for config from .env
	PubSubTopic            string
	PubSubSubPrefix        string
	TerraformModuleVersion string
	ManagedByLabel         string
	DefaultRegion          string
	AppMigrationScriptPath string

	// Track auth status
	mu              sync.RWMutex
	authStatus      string
	filterStatus    string
	planStatus      string
	migrationStatus string
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

func (h *APIHandler) GetFilterStatus(c *gin.Context) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"status": h.filterStatus})
}

func (h *APIHandler) GetPlanStatus(c *gin.Context) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"status": h.planStatus})
}

func (h *APIHandler) GetMigrationStatus(c *gin.Context) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"status": h.migrationStatus})
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

	h.mu.Lock()
	h.filterStatus = "Starting filter process..."
	h.mu.Unlock()

	go func() {
		ctx := context.Background()
		svc, err := discovery.NewFilterService(ctx, projectID, impersonate, h.ServiceAccountJSON)
		if err != nil {
			h.mu.Lock()
			h.filterStatus = fmt.Sprintf("Failed to init filter service: %v", err)
			h.mu.Unlock()
			return
		}

		// Construct the correct, project-specific path for filtering
		projectDataDir := strings.Replace(h.DataDir, "GCP_PROJECT", projectID, 1)
		log.Printf("FilterGCP: Using data directory: %s", projectDataDir)

		if err := svc.FilterAndConsolidate(ctx, projectDataDir, func(status string) {
			h.mu.Lock()
			h.filterStatus = status
			h.mu.Unlock()
		}); err != nil {
			h.mu.Lock()
			h.filterStatus = fmt.Sprintf("Filtering failed: %v", err)
			h.mu.Unlock()
		}
	}()

	c.JSON(http.StatusOK, gin.H{"status": "Filter process started."})
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

	// Scan the entire bucket for state files.
	bucket := client.Bucket(h.TerraformStateBucket)
	query := &storage.Query{} // No prefix, list all objects.

	managedResources := make(map[string][][]string)
	it := bucket.Objects(ctx, query)
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			log.Printf("Error iterating bucket objects: %v", err)
			// Continue instead of failing the whole request for one bad object
			continue
		}

		// We only care about terraform state files.
		if !strings.HasSuffix(attrs.Name, ".tfstate") {
			continue
		}

		// The path prefix for a resource is its directory.
		// e.g., "all-resources/gcs/mg-my-bucket/default.tfstate" -> "all-resources/gcs/mg-my-bucket"
		prefix := filepath.Dir(attrs.Name)
		parts := strings.Split(prefix, "/")
		if len(parts) < 2 {
			continue
		}
		// The last two parts of the prefix are the type and name.
		serviceType := parts[len(parts)-2]
		resourceName := parts[len(parts)-1]

		// Use the original name for display
		displayName := strings.TrimPrefix(resourceName, h.ResourcePrefix)

		if _, ok := managedResources[serviceType]; !ok {
			// Create header
			managedResources[serviceType] = [][]string{{"ResourceName", "Terraform Name", "ServiceType", "State File Path"}}
		}
		managedResources[serviceType] = append(managedResources[serviceType], []string{displayName, resourceName, serviceType, attrs.Name})
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
	Labels     map[string]string
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
	Labels       map[string]string
	FastRef      string
}

type GKEData struct {
	ProjectID   string
	Region      string
	ClusterName string
	Network     string
	Subnetwork  string
	Labels      map[string]string
	FastRef     string
}

type SQLData struct {
	ProjectID string
	Region    string
	DBName    string
	Network   string
	DBVersion string
	Tier      string
	Labels    map[string]string
	FastRef   string
}

type LBData struct {
	ProjectID string
	Region    string
	LBName    string
	FastRef   string
	Labels    map[string]string
}

type FallbackData struct {
	ProjectID   string
	Region      string
	Name        string
	FastRef     string
	Labels      map[string]string
	ServiceType string
}

func (h *APIHandler) mapFromUnifiedResource(serviceType string, header []string, row []string) (string, interface{}, string) {
	m := make(map[string]string)
	for i, h := range header {
		if i < len(row) {
			m[h] = row[i]
		}
	}
	resName := m["ResourceName"]
	projectID := m["ProjectID"]

	prefix := h.ResourcePrefix
	if prefix == "" {
		prefix = "mg-" // Fallback prefix if not set in env
	}
	newResName := prefix + resName

	region := m["NewRegion"]
	if region == "" {
		region = h.DefaultRegion
	}
	if region == "" {
		region = m["Region"]
	}
	if region == "" || region == "global" {
		region = "us-east1" // default placeholder
	}

	newSubnet := m["NewSubnet"]

	managedBy := h.ManagedByLabel
	if managedBy == "" {
		managedBy = "geoshield" // Fallback label
	}
	labels := map[string]string{"managed-by": managedBy}

	// Use stable release tag for Fabric modules instead of AssetType
	fastRef := h.TerraformModuleVersion
	if fastRef == "" {
		fastRef = "v20.0.0" // Fallback version
	}

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
	case "compute.Instance":
		zone := region + "-a"
		if m["NewRegion"] != "" {
			zone = region + "-a"
		}
		return "compute-vm", VMData{projectID, region, newResName, zone, "default", "default", "e2-medium", "debian-cloud/debian-11", labels, fastRef}, newResName
	case "storage.Bucket":
		return "gcs", GCSData{projectID, region, newResName, "US", labels, true, fastRef}, newResName
	case "container.Cluster":
		return "gke-cluster", GKEData{projectID, region, newResName, "default", "default", labels, fastRef}, newResName
	case "sqladmin.Instance":
		return "cloudsql-instance", SQLData{projectID, region, newResName, "default", "POSTGRES_18", "db-f1-micro", labels, fastRef}, newResName
	case "compute.ForwardingRule":
		return "net-lb-app-ext", LBData{projectID, region, newResName, fastRef, labels}, newResName
	default:
		// Map any other selected resource to the fallback generic module
		return "fallback", FallbackData{projectID, region, newResName, fastRef, labels, serviceType}, newResName
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

	h.mu.Lock()
	h.planStatus = "Starting plan process..."
	h.mu.Unlock()

	go func() {
		ctx := context.Background() // Create a new context for the long-running background task
		log.Printf("Successfully received and parsed plan payload for %d resource types.", len(payload.Resources))
		projectID := c.Query("project")
		if projectID == "" {
			h.mu.Lock()
			h.planStatus = "Error: project ID is required"
			h.mu.Unlock()
			return
		}

		// --- Start: Ephemeral Workspace ---
		runID := uuid.New().String()
		workspaceDir := filepath.Join(h.OutputDir, "run-"+runID)
		log.Printf("Creating ephemeral workspace: %s", workspaceDir)
		if err := os.MkdirAll(workspaceDir, 0755); err != nil {
			log.Printf("Error creating ephemeral workspace: %v", err)
			h.planStatus = fmt.Sprintf("Error: Failed to create workspace: %v", err)
			return
		}

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
				mappedType, resData, resName := h.mapFromUnifiedResource(serviceType, header, row)
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
			h.mu.Lock()
			h.planStatus = fmt.Sprintf("Error generating terraform code: %v", err)
			h.mu.Unlock()
			return
		}

		var combinedOutput string
		var finalPlanOutput string // Use a separate variable for the final plan content
		for i, res := range config.Resources {
			path := filepath.Join(workspaceDir, config.FolderName, res.Type, res.Name)
			displayType := res.Type
			if fbData, ok := res.Data.(FallbackData); ok {
				displayType = fbData.ServiceType
			}

			status := fmt.Sprintf("[%d/%d] Initializing Terraform for %s: %s", i+1, len(config.Resources), displayType, res.Name)
			h.mu.Lock()
			h.planStatus = status
			h.mu.Unlock()
			log.Println(status)

			prefixPath := filepath.Join(config.FolderName, res.Type, res.Name)
			initCmd := exec.CommandContext(ctx, "terraform", "init", "-no-color", fmt.Sprintf("-backend-config=bucket=%s", config.TerraformStateBucket), fmt.Sprintf("-backend-config=prefix=%s", prefixPath))
			initCmd.Dir = path // Set working directory
			initOutput, err := h.runCommandAndStreamStatus(initCmd, fmt.Sprintf("Init for %s: %s", displayType, res.Name))
			combinedOutput += initOutput
			if err != nil {
				continue // Stop processing this resource if init fails
			}

			status = fmt.Sprintf("[%d/%d] Generating Terraform plan file for %s: %s", i+1, len(config.Resources), displayType, res.Name)
			h.mu.Lock()
			h.planStatus = status
			h.mu.Unlock()
			log.Println(status)

			planFilePath := filepath.Join(path, "terraform.tfplan")
			planCmd := exec.CommandContext(ctx, "terraform", "plan", "-no-color", "-out="+planFilePath)
			planCmd.Dir = path // Set working directory
			planOutput, err := h.runCommandAndStreamStatus(planCmd, fmt.Sprintf("Plan for %s: %s", displayType, res.Name))
			combinedOutput += planOutput
			if err != nil {
				finalPlanOutput += planOutput // Capture the plan error for the UI
				continue                      // Stop processing this resource if plan fails
			}

			showCmd := exec.CommandContext(ctx, "terraform", "show", "-no-color", planFilePath)
			showCmd.Dir = path
			showOutput, err := showCmd.CombinedOutput()
			if err != nil {
				log.Printf("-> Terraform show failed for %s: %v", res.Name, err)
				finalPlanOutput += fmt.Sprintf("=== Show Plan Error for %s: %s ===\n%s\n", displayType, res.Name, string(showOutput))
				continue
			}
			finalPlanOutput += fmt.Sprintf("=== Plan for %s: %s ===\n%s\n", displayType, res.Name, string(showOutput))
		}

		if len(config.Resources) == 0 {
			finalPlanOutput = "No supported resources selected for planning."
		}

		log.Printf("Completed planning for %d resources.", len(config.Resources))
		h.mu.Lock()
		h.planStatus = fmt.Sprintf("COMPLETED::%s::%s", runID, finalPlanOutput)
		h.mu.Unlock()
	}()

	c.JSON(http.StatusOK, gin.H{"status": "Plan process started."})
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

	go func() {
		ctx := context.Background()
		client, err := storage.NewClient(ctx)
		if err != nil {
			h.planStatus = fmt.Sprintf("Error: failed to create storage client: %v", err)
			return
		}
		defer client.Close()

		// --- Start: Use Existing Workspace ---
		workspaceDir := filepath.Join(h.OutputDir, "run-"+payload.WorkspaceID)
		log.Printf("Using existing workspace for apply: %s", workspaceDir)
		if _, err := os.Stat(workspaceDir); os.IsNotExist(err) {
			h.planStatus = "Error: Workspace not found. It may have expired or been deleted. Please generate a new plan."
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
			Cloud:                h.TerraformCloud,
			OrgName:              h.TerraformOrgName,
			FolderName:           h.TerraformFolderName,
			ProjectName:          projectID,
			PathPattern:          "{{.FolderName}}/{{.Type}}/{{.Name}}",
			TerraformStateBucket: h.TerraformStateBucket,
		}

		for serviceType, rows := range payload.Resources {
			if len(rows) < 2 {
				continue
			}
			header := rows[0]
			for i := 1; i < len(rows); i++ {
				row := rows[i]
				mappedType, resData, resName := h.mapFromUnifiedResource(serviceType, header, row)
				if mappedType == "" {
					continue
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
			path := filepath.Join(workspaceDir, config.FolderName, res.Type, res.Name)

			displayType := res.Type
			if fbData, ok := res.Data.(FallbackData); ok {
				displayType = fbData.ServiceType
			}

			planFilePath := filepath.Join(path, "terraform.tfplan")
			status := fmt.Sprintf("[%d/%d] Applying Terraform plan for %s: %s", i+1, len(config.Resources), displayType, res.Name)
			log.Println(status)
			h.mu.Lock()
			h.planStatus = status
			h.mu.Unlock()

			applyCmd := exec.CommandContext(ctx, "terraform", "apply", "-no-color", "-auto-approve", planFilePath)
			applyCmd.Dir = path

			output, err := h.runCommandAndStreamStatus(applyCmd, fmt.Sprintf("Apply for %s: %s", displayType, res.Name))
			combinedOutput += output
			if err != nil {
				log.Printf("-> Terraform apply failed for %s: %v", res.Name, err)
			} else {
				gcsPath := filepath.Join(config.FolderName, res.Type, res.Name)
				log.Printf("Uploading generated code for %s to gs://%s/%s", res.Name, h.TerraformStateBucket, gcsPath)
				if uploadErr := uploadDirectoryToGCS(ctx, client, h.TerraformStateBucket, path, gcsPath); uploadErr != nil {
					log.Printf("-> Failed to upload generated code for %s: %v", res.Name, uploadErr)
					combinedOutput += fmt.Sprintf("\n--- WARNING: Failed to upload generated code to GCS for %s ---\n", res.Name)
				}
			}
		}

		if len(config.Resources) == 0 {
			combinedOutput = "No supported resources selected for applying."
		}

		log.Printf("Completed applying for %d resources.", len(config.Resources))
		h.mu.Lock()
		h.planStatus = fmt.Sprintf("APPLY_COMPLETED::%s", combinedOutput)
		h.mu.Unlock()
	}()

	c.JSON(http.StatusOK, gin.H{"status": "Apply process started."})
}

// runCommandAndStreamStatus executes a command, streams its stdout/stderr to the planStatus,
// and returns the combined output as a string.
func (h *APIHandler) runCommandAndStreamStatus(cmd *exec.Cmd, header string) (string, error) {
	var outputBuf bytes.Buffer

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Sprintf("Error creating stdout pipe: %v", err), err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Sprintf("Error creating stderr pipe: %v", err), err
	}

	if err := cmd.Start(); err != nil {
		return fmt.Sprintf("Error starting command: %v", err), err
	}

	// Use a MultiReader to process both stdout and stderr in one loop
	multiReader := io.MultiReader(stdout, stderr)
	scanner := bufio.NewScanner(multiReader)
	for scanner.Scan() {
		line := scanner.Text()
		log.Printf("[%s] %s", cmd.Args[0], line)
		outputBuf.WriteString(line + "\n")

		// Update the shared status for the frontend to poll
		h.mu.Lock()
		h.planStatus = line
		h.mu.Unlock()
	}

	waitErr := cmd.Wait()
	if waitErr != nil {
		log.Printf("Command finished with error: %v", waitErr)
	}

	return fmt.Sprintf("=== %s ===\n%s\n", header, outputBuf.String()), waitErr
}

func uploadDirectoryToGCS(ctx context.Context, client *storage.Client, bucketName, localPath, gcsPath string) error {
	return filepath.Walk(localPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if info.Name() == ".terraform" {
				log.Printf("Skipping .terraform directory from GCS upload: %s", path)
				return filepath.SkipDir
			}
			return nil // It's a directory we want to traverse, but not upload itself.
		}

		relPath, err := filepath.Rel(localPath, path)
		if err != nil {
			return err
		}

		gcsObjectPath := filepath.Join(gcsPath, relPath)
		wc := client.Bucket(bucketName).Object(gcsObjectPath).NewWriter(ctx)

		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()

		if _, err := io.Copy(wc, f); err != nil {
			return fmt.Errorf("io.Copy: %w", err)
		}
		if err := wc.Close(); err != nil {
			return fmt.Errorf("Writer.Close: %w", err)
		}
		log.Printf("Successfully uploaded %s to gs://%s/%s", path, bucketName, gcsObjectPath)
		return nil
	})
}

func downloadDirectoryFromGCS(ctx context.Context, client *storage.Client, bucketName, gcsPath, localPath string) error {
	it := client.Bucket(bucketName).Objects(ctx, &storage.Query{Prefix: gcsPath})
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return fmt.Errorf("Bucket.Objects: %w", err)
		}

		// Get the relative path of the object to create the correct local structure
		relPath, err := filepath.Rel(gcsPath, attrs.Name)
		if err != nil {
			log.Printf("Could not get relative path for %s from %s: %v", attrs.Name, gcsPath, err)
			continue
		}
		localFilePath := filepath.Join(localPath, relPath)

		if err := os.MkdirAll(filepath.Dir(localFilePath), 0755); err != nil {
			return fmt.Errorf("MkdirAll: %w", err)
		}

		rc, err := client.Bucket(bucketName).Object(attrs.Name).NewReader(ctx)
		if err != nil {
			return fmt.Errorf("Object.NewReader: %w", err)
		}
		defer rc.Close()

		f, err := os.Create(localFilePath)
		if err != nil {
			return fmt.Errorf("os.Create: %w", err)
		}
		defer f.Close()

		if _, err := io.Copy(f, rc); err != nil {
			return fmt.Errorf("io.Copy: %w", err)
		}
		log.Printf("Successfully downloaded gs://%s/%s to %s", bucketName, attrs.Name, localFilePath)
	}
	return nil
}

// deleteGCSFolder deletes all objects within a given GCS prefix (effectively a folder)
func deleteGCSFolder(ctx context.Context, client *storage.Client, bucketName, gcsPath string) error {
	it := client.Bucket(bucketName).Objects(ctx, &storage.Query{Prefix: gcsPath})
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return fmt.Errorf("Bucket.Objects: %w", err)
		}
		if err := client.Bucket(bucketName).Object(attrs.Name).Delete(ctx); err != nil {
			return fmt.Errorf("Object(%q).Delete: %w", attrs.Name, err)
		}
		log.Printf("Deleted GCS object: gs://%s/%s", bucketName, attrs.Name)
	}
	return nil
}

// executeTerraformPlan is no longer used for streaming, keeping for reference if needed elsewhere.
// It should be removed if not used.
// func executeTerraformPlan(config generator.Config, workspaceDir string, isDestroy bool) string {
func executeTerraformPlan(config generator.Config, workspaceDir string, isDestroy bool) string {
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

		planFilePath := filepath.Join(path, "terraform.tfplan")
		planArgs := []string{"plan", "-no-color", "-out=" + planFilePath}
		if isDestroy {
			planArgs = append(planArgs, "-destroy")
		}
		planCmd := exec.Command("terraform", planArgs...)
		planCmd.Dir = path
		planOutput, err := planCmd.CombinedOutput()
		if err != nil {
			log.Printf("-> Terraform plan failed for %s: %v", res.Name, err)
			combinedOutput += fmt.Sprintf("=== Plan Error for %s: %s ===\n%s\n", displayType, res.Name, string(planOutput))
			continue
		}

		showCmd := exec.Command("terraform", "show", "-no-color", planFilePath)
		showCmd.Dir = path
		showOutput, err := showCmd.CombinedOutput()
		if err != nil {
			log.Printf("-> Terraform show failed for %s: %v", res.Name, err)
			combinedOutput += fmt.Sprintf("=== Show Plan Error for %s: %s ===\n%s\n", displayType, res.Name, string(showOutput))
			continue
		}
		combinedOutput += fmt.Sprintf("=== Plan for %s: %s ===\n%s\n", displayType, res.Name, string(showOutput))
	}
	return combinedOutput
}

type UnlockPayload struct {
	Resources map[string][][]string `json:"resources"`
}

func (h *APIHandler) ForceUnlockTerraform(c *gin.Context) {
	var payload UnlockPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	projectID := c.Query("project")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project ID is required"})
		return
	}

	var combinedOutput string
	for serviceType, rows := range payload.Resources {
		if len(rows) < 2 {
			continue
		}
		header := rows[0]
		for i := 1; i < len(rows); i++ {
			row := rows[i]
			_, _, resName := h.mapFromUnifiedResource(serviceType, header, row)

			// We don't need a full workspace, just a temporary directory to run the command
			tempDir, err := os.MkdirTemp("", "geoshield-unlock-*")
			if err != nil {
				combinedOutput += fmt.Sprintf("=== Error creating temp dir for %s ===\n%v\n", resName, err)
				continue
			}
			defer os.RemoveAll(tempDir)

			// The key is to initialize the backend configuration so Terraform knows where to look for the lock.
			prefix := filepath.Join(h.TerraformFolderName, serviceType, resName)
			initCmd := exec.Command("terraform", "init", "-no-color", "-reconfigure",
				fmt.Sprintf("-backend-config=bucket=%s", h.TerraformStateBucket),
				fmt.Sprintf("-backend-config=prefix=%s", prefix),
			)
			initCmd.Dir = tempDir
			if _, err := initCmd.CombinedOutput(); err != nil {
				combinedOutput += fmt.Sprintf("=== Init failed for unlock on %s ===\n%v\n", resName, err)
				continue
			}

			unlockCmd := exec.Command("terraform", "force-unlock", prefix) // Using the prefix as the lock ID hint
			unlockCmd.Dir = tempDir
			output, _ := unlockCmd.CombinedOutput()
			combinedOutput += fmt.Sprintf("=== Unlock attempt for %s ===\n%s\n", resName, string(output))
		}
	}
	c.JSON(http.StatusOK, gin.H{"unlock_output": combinedOutput})
}

type DestroyPlanPayload struct {
	Resources map[string][][]string `json:"resources"`
}

func (h *APIHandler) PlanDestroyTerraform(c *gin.Context) {
	var payload DestroyPlanPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	projectID := c.Query("project")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project ID is required"})
		return
	}

	h.mu.Lock()
	h.planStatus = "Starting destroy plan process..."
	h.mu.Unlock()

	go func() {
		ctx := context.Background()

		runID := uuid.New().String()
		workspaceDir := filepath.Join(h.OutputDir, "run-"+runID)
		log.Printf("Creating ephemeral workspace for destroy plan: %s", workspaceDir)
		if err := os.MkdirAll(workspaceDir, 0755); err != nil {
			log.Printf("Error creating ephemeral workspace for destroy plan: %v", err)
			h.planStatus = fmt.Sprintf("Error: Failed to create workspace: %v", err)
			return
		}

		config := generator.Config{
			Cloud:                h.TerraformCloud,
			OrgName:              h.TerraformOrgName,
			FolderName:           h.TerraformFolderName,
			ProjectName:          projectID,
			PathPattern:          "{{.FolderName}}/{{.Type}}/{{.Name}}",
			TerraformStateBucket: h.TerraformStateBucket,
		}

		client, err := storage.NewClient(ctx)
		if err != nil {
			h.planStatus = fmt.Sprintf("Error: failed to create storage client: %v", err)
			return
		}
		defer client.Close()

		// This loop is identical to DestroyTerraform's setup. It generates placeholder .tf files
		// so Terraform knows which state to check.
		for _, rows := range payload.Resources {
			if len(rows) < 2 { // Should have header + at least one data row
				continue
			}
			// The payload for destroy plan should only contain the selected resources.
			// We iterate through the selected resources to download their original code.
			header := rows[0]
			_ = header // Not used directly, but good to acknowledge
			for _, row := range rows[1:] {
				if len(row) < 4 {
					log.Printf("Skipping malformed row for destroy plan: %v", row)
					continue
				}
				resName := row[1]               // Terraform Name
				resServiceType := row[2]        // Service Type
				gcsPath := filepath.Dir(row[3]) // Get the directory from the state file path

				localPath := filepath.Join(workspaceDir, gcsPath)
				log.Printf("Downloading original configuration for %s from gs://%s/%s to %s", resName, h.TerraformStateBucket, gcsPath, localPath)
				downloadDirectoryFromGCS(ctx, client, h.TerraformStateBucket, gcsPath, localPath)
				config.Resources = append(config.Resources, generator.Resource{
					Type: resServiceType,
					Name: resName,
				})
			}
		}

		var finalPlanOutput string
		for i, res := range config.Resources {
			path := filepath.Join(workspaceDir, config.FolderName, res.Type, res.Name)
			displayType := res.Type
			if fbData, ok := res.Data.(FallbackData); ok {
				displayType = fbData.ServiceType
			}

			status := fmt.Sprintf("[%d/%d] Initializing Terraform for destroy plan on %s: %s", i+1, len(config.Resources), displayType, res.Name)
			log.Println(status)
			h.mu.Lock()
			h.planStatus = status
			h.mu.Unlock()

			prefix := filepath.Join(config.FolderName, res.Type, res.Name)
			initCmd := exec.CommandContext(ctx, "terraform", "init", "-no-color",
				fmt.Sprintf("-backend-config=bucket=%s", config.TerraformStateBucket),
				fmt.Sprintf("-backend-config=prefix=%s", prefix),
			)
			initCmd.Dir = path
			if _, err := h.runCommandAndStreamStatus(initCmd, fmt.Sprintf("Init for %s", res.Name)); err != nil {
				continue
			}

			planFilePath := filepath.Join(path, "terraform.tfplan")
			planCmd := exec.CommandContext(ctx, "terraform", "plan", "-no-color", "-destroy", "-out="+planFilePath)
			planCmd.Dir = path
			if planOutput, err := h.runCommandAndStreamStatus(planCmd, fmt.Sprintf("Destroy Plan for %s", res.Name)); err != nil {
				finalPlanOutput += planOutput
				continue
			}

			showCmd := exec.CommandContext(ctx, "terraform", "show", "-no-color", planFilePath)
			showCmd.Dir = path
			showOutput, _ := showCmd.CombinedOutput()
			finalPlanOutput += fmt.Sprintf("=== Destroy Plan for %s: %s ===\n%s\n", displayType, res.Name, string(showOutput))
		}

		log.Printf("Completed destroy planning for %d resources.", len(config.Resources))
		h.mu.Lock()
		h.planStatus = fmt.Sprintf("COMPLETED::%s::%s", runID, finalPlanOutput)
		h.mu.Unlock()
	}()

	c.JSON(http.StatusOK, gin.H{"status": "Destroy plan process started."})
}

type DestroyPayload struct {
	WorkspaceID string                `json:"workspaceId"`
	Resources   map[string][][]string `json:"resources"` // Add this to carry selected resources
}

func (h *APIHandler) DestroyTerraform(c *gin.Context) {
	var payload DestroyPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	if payload.WorkspaceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "workspaceId is required for destroy"})
		return
	}

	if len(payload.Resources) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No resources selected for destruction"})
		return
	}

	// Asynchronous execution for streaming updates
	projectID := c.Query("project")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project ID is required"})
		return
	}

	go func() {
		ctx := context.Background()
		client, err := storage.NewClient(ctx)
		if err != nil {
			h.planStatus = fmt.Sprintf("Error: failed to create storage client: %v", err)
			return
		}
		defer client.Close()

		// --- Start: Use Existing Workspace ---
		workspaceDir := filepath.Join(h.OutputDir, "run-"+payload.WorkspaceID) // Use the workspace from the plan
		log.Printf("Using existing workspace for destroy: %s", workspaceDir)
		if _, err := os.Stat(workspaceDir); os.IsNotExist(err) {
			h.planStatus = "Error: Workspace not found. It may have expired or been deleted. Please generate a new destroy plan."
			return
		}

		// Defer cleanup to ensure workspace is always removed
		defer func() {
			log.Printf("Cleaning up ephemeral workspace for destroy: %s", workspaceDir)
			os.RemoveAll(workspaceDir)
		}()
		// --- End: Ephemeral Workspace ---

		var combinedOutput string
		var resourcesToProcess []generator.Resource // To hold the actual resources to destroy

		// Reconstruct config.Resources from payload.Resources
		for _, rows := range payload.Resources {
			if len(rows) < 2 {
				continue
			}
			_ = rows[0] // header is not used in this loop
			for i := 1; i < len(rows); i++ {
				row := rows[i]
				// Assuming row[1] is Terraform Name and row[2] is ServiceType
				resName := row[1]
				resServiceType := row[2]
				resourcesToProcess = append(resourcesToProcess, generator.Resource{
					Type: resServiceType,
					Name: resName,
				})
			}
		}

		if len(resourcesToProcess) == 0 {
			combinedOutput = "No resources found in payload for destruction."
			h.mu.Lock()
			h.planStatus = fmt.Sprintf("DESTROY_COMPLETED::%s", combinedOutput)
			h.mu.Unlock()
			return
		}

		for i, res := range resourcesToProcess {
			// Path is now inside the unique workspace for this specific resource
			path := filepath.Join(workspaceDir, h.TerraformFolderName, res.Type, res.Name)

			displayType := res.Type
			// No FallbackData needed here, as we are destroying specific resources

			status := fmt.Sprintf("[%d/%d] Initializing Terraform for destroy of %s: %s", i+1, len(resourcesToProcess), displayType, res.Name)
			log.Println(status)
			h.mu.Lock()
			h.planStatus = status
			h.mu.Unlock()

			// CRITICAL FIX: Run 'terraform init' before destroy to install modules.
			prefix := filepath.Join(h.TerraformFolderName, res.Type, res.Name)
			initCmd := exec.CommandContext(ctx, "terraform", "init", "-no-color",
				fmt.Sprintf("-backend-config=bucket=%s", h.TerraformStateBucket),
				fmt.Sprintf("-backend-config=prefix=%s", prefix),
			)
			initCmd.Dir = path
			if initOutput, err := h.runCommandAndStreamStatus(initCmd, fmt.Sprintf("Init for destroy of %s", res.Name)); err != nil {
				log.Printf("-> Terraform init failed during destroy for %s: %v", res.Name, err)
				combinedOutput += fmt.Sprintf("=== Init Error for %s ===\n%s\n", res.Name, initOutput)
				continue
			}

			destroyCmd := exec.CommandContext(ctx, "terraform", "destroy", "-auto-approve", "-no-color")
			destroyCmd.Dir = path
			output, err := h.runCommandAndStreamStatus(destroyCmd, fmt.Sprintf("Destroying %s", res.Name))

			combinedOutput += output
			if err != nil {
				log.Printf("-> Terraform destroy failed for %s: %v", res.Name, err)
			} else {
				// On successful destroy, clean up the files from GCS.
				gcsPath := filepath.Join(h.TerraformFolderName, res.Type, res.Name)
				log.Printf("Cleaning up GCS path: gs://%s/%s", h.TerraformStateBucket, gcsPath)
				// Delete the state file and any generated .tf files for this specific resource
				if deleteErr := deleteGCSFolder(ctx, client, h.TerraformStateBucket, gcsPath); deleteErr != nil {
					log.Printf("-> Failed to delete GCS folder for %s: %v", res.Name, deleteErr)
					combinedOutput += fmt.Sprintf("\n--- WARNING: Failed to clean up GCS state for %s ---\n", res.Name)
				}
			}
		}

		log.Printf("Completed destroying for %d resources.", len(resourcesToProcess))
		h.mu.Lock()
		h.planStatus = fmt.Sprintf("DESTROY_COMPLETED::%s", combinedOutput)
		h.mu.Unlock()
	}()

	c.JSON(http.StatusOK, gin.H{"status": "Destroy process started."})
}

// WebSocketMessage defines the structure of messages sent over the WebSocket
type WebSocketMessage struct {
	Data        string    `json:"data"`
	PublishTime time.Time `json:"publishTime"`
	MessageID   string    `json:"messageId"`
}

var upgrader = websocket.Upgrader{
	// Allow all origins for development purposes.
	// In production, you should restrict this to your frontend's domain.
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func (h *APIHandler) StreamPubSubMessagesWS(c *gin.Context) {
	projectID := c.Query("project")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project ID is required"})
		return
	}
	topicName := h.PubSubTopic
	if topicName == "" {
		log.Printf("PUBSUB_STREAMING_TOPIC environment variable not set.")
		return
	}

	// Upgrade the HTTP connection to a WebSocket connection
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("Failed to upgrade connection to WebSocket: %v", err)
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		log.Printf("Failed to create pubsub client: %v", err)
		conn.WriteMessage(websocket.TextMessage, []byte("Error: Failed to create Pub/Sub client."))
		return
	}
	defer client.Close()

	topic := client.Topic(topicName)
	exists, err := topic.Exists(ctx)
	if err != nil || !exists {
		log.Printf("Topic '%s' not found or error checking existence: %v", topicName, err)
		conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("Error: Topic '%s' not found in project '%s'.", topicName, projectID)))
		return
	}

	// Create a temporary subscription for this WebSocket session
	subPrefix := h.PubSubSubPrefix
	if subPrefix == "" {
		subPrefix = "geoshield-ws-sub-" // Fallback prefix
	}
	subID := subPrefix + uuid.New().String()
	sub, err := client.CreateSubscription(ctx, subID, pubsub.SubscriptionConfig{
		Topic:            topic,
		ExpirationPolicy: 24 * time.Hour, // Automatically clean up
	})
	if err != nil {
		log.Printf("Failed to create temporary subscription: %v", err)
		conn.WriteMessage(websocket.TextMessage, []byte("Error: Failed to create temporary subscription."))
		return
	}
	// Ensure the subscription is deleted when the function returns (e.g., on disconnect)
	defer sub.Delete(context.Background())

	// --- RETAIN AND DISPLAY HISTORY ---
	// This is the key change. We seek the subscription's starting point to 24 hours ago.
	// Pub/Sub will then deliver all messages from the topic's history from that point forward.
	log.Printf("Seeking subscription '%s' to 24 hours ago to retrieve message history.", subID)
	seekTime := time.Now().Add(-24 * time.Hour)
	if err := sub.SeekToTime(ctx, seekTime); err != nil {
		log.Printf("Failed to seek subscription: %v", err)
		conn.WriteMessage(websocket.TextMessage, []byte("Error: Failed to retrieve message history."))
	}

	log.Printf("WebSocket connected. Streaming messages from topic '%s'", topicName)

	// --- FIX for Concurrent Writes ---
	// Create a buffered channel to queue messages for the WebSocket.
	// This ensures that only one goroutine (the writer below) ever writes to the connection.
	sendChan := make(chan WebSocketMessage, 256)

	// Start a single writer goroutine. It reads from the sendChan and writes to the WebSocket.
	go func() {
		for wsMsg := range sendChan {
			// Marshal the structured message to JSON before sending
			jsonMsg, err := json.Marshal(wsMsg)
			if err != nil {
				log.Printf("Error marshalling WebSocket message: %v", err)
				continue // Skip this message but don't break the loop
			}
			if err := conn.WriteMessage(websocket.TextMessage, jsonMsg); err != nil {
				log.Printf("Error writing message to WebSocket: %v", err)
				// If writing fails, the connection is likely broken.
				// We cancel the context to stop the Pub/Sub receiver.
				cancel()
				return
			}
			log.Printf("Sent message to WebSocket: %s", string(jsonMsg))
		}
	}()

	// Goroutine to read messages from Pub/Sub and send them to the safe write channel.
	go func() {
		// Ensure the send channel is closed when Receive returns, which unblocks the writer goroutine.
		defer func() {
			log.Println("Pub/Sub receiver goroutine exiting, closing send channel.")
			close(sendChan)
		}()
		err := sub.Receive(ctx, func(ctx context.Context, msg *pubsub.Message) {
			log.Printf("Got message: %s", string(msg.Data))
			// Construct a WebSocketMessage struct and send it to the channel.
			sendChan <- WebSocketMessage{
				Data:        string(msg.Data),
				PublishTime: msg.PublishTime,
				MessageID:   msg.ID,
			}
			msg.Ack()
		})
		// context.Canceled is an expected error when the client disconnects.
		// We only log other, unexpected errors.
		if err != nil && ctx.Err() == nil {
			log.Printf("Error receiving from Pub/Sub: %v", err)
		}
	}()

	// Loop to read messages from the client (for bi-directional communication)
	for {
		// The ReadMessage loop is the primary owner of the connection.
		// If it returns an error, it means the client has disconnected.
		messageType, p, err := conn.ReadMessage()
		if err != nil {
			log.Printf("WebSocket read error (client likely disconnected): %v", err)
			break // Exit loop on error
		}
		if messageType == websocket.TextMessage {
			// For now, we just log the message received from the client.
			// In the future, you could publish this message to a Pub/Sub topic.
			log.Printf("Message received from client: %s", string(p))
			topic.Publish(ctx, &pubsub.Message{Data: p})
		}
	}
}

type StateRemovalPayload struct {
	ResourceAddress string `json:"resourceAddress"` // e.g., "google_project_service.service_networking"
	ServiceType     string `json:"serviceType"`     // e.g., "cloudsql-instance"
	ResourceName    string `json:"resourceName"`    // e.g., "my-pg-sql-demo"
}

func (h *APIHandler) RemoveFromState(c *gin.Context) {
	var payload StateRemovalPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	if payload.ResourceAddress == "" || payload.ServiceType == "" || payload.ResourceName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "resourceAddress, serviceType, and resourceName are required"})
		return
	}

	// We need a temporary directory to run terraform commands with the correct backend config
	tempDir, err := os.MkdirTemp("", "geoshield-staterm-*")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to create temp dir: %v", err)})
		return
	}
	defer os.RemoveAll(tempDir)

	// Initialize the backend so Terraform knows where to find the state
	prefix := filepath.Join(h.TerraformFolderName, payload.ServiceType, payload.ResourceName)
	initCmd := exec.Command("terraform", "init", "-no-color", "-reconfigure",
		fmt.Sprintf("-backend-config=bucket=%s", h.TerraformStateBucket),
		fmt.Sprintf("-backend-config=prefix=%s", prefix),
	)
	initCmd.Dir = tempDir
	if initOutput, err := initCmd.CombinedOutput(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Terraform init failed", "details": string(initOutput)})
		return
	}

	// Run the state rm command
	stateRmCmd := exec.Command("terraform", "state", "rm", payload.ResourceAddress)
	stateRmCmd.Dir = tempDir
	output, err := stateRmCmd.CombinedOutput()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Terraform state rm failed", "details": string(output)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "Successfully removed resource from state.", "details": string(output)})
}

func (h *APIHandler) AppMigration(c *gin.Context) {
	h.mu.Lock()
	h.migrationStatus = "Starting app migration script..."
	h.mu.Unlock()

	go func() {
		if h.AppMigrationScriptPath == "" {
			errMsg := "Failed: App migration script path is not configured on the server."
			log.Println("Error:", errMsg)
			h.mu.Lock()
			h.migrationStatus = errMsg
			h.mu.Unlock()
			// We don't send a response here because the main function already did.
			return
		}

		scriptPath := h.AppMigrationScriptPath
		scriptDir := filepath.Dir(scriptPath)
		cmd := exec.Command("/bin/sh", scriptPath)
		cmd.Dir = scriptDir // Set the working directory

		var out bytes.Buffer
		var stderr bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &stderr

		err := cmd.Run()

		h.mu.Lock()
		defer h.mu.Unlock()

		if err != nil {
			h.migrationStatus = fmt.Sprintf("Failed: %v\n%s", err, stderr.String())
		} else {
			h.migrationStatus = fmt.Sprintf("Completed: %s", out.String())
		}
	}()

	// Check for configuration error before returning OK
	if h.AppMigrationScriptPath == "" {
		errMsg := "App migration script path is not configured on the server."
		c.JSON(http.StatusInternalServerError, gin.H{"error": errMsg})
		return
	} else {
		c.JSON(http.StatusOK, gin.H{"status": "App migration script started."})
	}
}
