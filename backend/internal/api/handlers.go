package api

import (
	"context"
	"encoding/csv"
	"fmt"
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
	h.authStatus = "Pending"
	h.mu.Unlock()

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
	svc, err := discovery.NewDiscoveryService(ctx, projectID)
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
	svc, err := discovery.NewFilterService(ctx, projectID)
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
	file := filepath.Join(h.DataDir, "active_important_resources.csv")
	f, err := os.Open(file)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "active resources file not found"})
		return
	}
	defer f.Close()

	rows, err := csv.NewReader(f).ReadAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse active resources"})
		return
	}

	c.JSON(http.StatusOK, rows)
}

func (h *APIHandler) PlanTerraform(c *gin.Context) {
	// For simplicity, execute plan in the specific directory we've been working on
	path := filepath.Join(h.OutputDir, "vikram-gcp-resources", "vpc", "wf-vpc-dev")
	cmd := exec.Command("terraform", "plan", "-no-color")
	cmd.Dir = path
	output, err := cmd.CombinedOutput()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": string(output)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"plan_output": string(output)})
}
