package main

import (
	"log"
	"os"
	"path/filepath"

	"example.com/geoShield/backend/internal/api"
	"example.com/geoShield/backend/internal/generator"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	cwd, err := os.Getwd()
	if err != nil {
		log.Fatalf("failed to get working dir: %v", err)
	}

	// Adjust cwd if we are running from within the backend directory
	rootDir := cwd
	if filepath.Base(cwd) == "backend" {
		rootDir = filepath.Dir(cwd)
	}

	_ = godotenv.Load(filepath.Join(rootDir, ".env"))

	h := &api.APIHandler{
		DataDir:          filepath.Join(rootDir, "data", "gcp"),
		OutputDir:        filepath.Join(rootDir, "output"),
		GenSvc:           generator.New(filepath.Join(rootDir, "backend", "templates")),
		ImpersonateEmail: os.Getenv("GCP_IMPERSONATE_EMAIL"),
	}

	if h.ImpersonateEmail != "" {
		log.Printf("Using Impersonation Email: %s", h.ImpersonateEmail)
	} else {
		log.Printf("No Impersonation Email provided, will run without impersonation if not specified per request.")
	}

	r := gin.Default()
	r.Use(cors.Default())

	r.POST("/api/gcp/auth", h.AuthGCP)
	r.GET("/api/gcp/auth/status", h.GetAuthStatus)
	r.POST("/api/gcp/discover", h.DiscoverGCP)
	r.GET("/api/gcp/resources", h.ListResources)
	r.GET("/api/gcp/resources/active", h.ListActiveResources)
	r.POST("/api/gcp/filter", h.FilterGCP)
	r.POST("/api/gcp/plan", h.PlanTerraform)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	r.Run(":" + port)
}

