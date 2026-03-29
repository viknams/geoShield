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
		DataDir:                   filepath.Join(rootDir, os.Getenv("DATA_DIR_GCP"), os.Getenv("GCP_PROJECT")),
		OutputDir:                 filepath.Join(rootDir, os.Getenv("OUTPUT_DIR")),
		GenSvc:                    generator.New(filepath.Join(rootDir, os.Getenv("TEMPLATE_DIR"))),
		ImpersonateEmail:          os.Getenv("GCP_IMPERSONATE_EMAIL"),
		ServiceAccountJSON:        os.Getenv("GCP_SERVICE_ACCOUNT_JSON"),
		TerraformStateBucket:      os.Getenv("TERRAFORM_STATE_BUCKET"),
		TerraformCloud:            os.Getenv("TERRAFORM_CLOUD"),
		TerraformOrgName:          os.Getenv("TERRAFORM_ORG_NAME"),
		TerraformFolderName:       os.Getenv("TERRAFORM_FOLDER_NAME"),
		TerraformCriticalResource: os.Getenv("TERRAFORM_CRITICAL_RESOURCE"),
	}

	// Log authentication source
	if os.Getenv("K_SERVICE") != "" {
		log.Printf("Running on Cloud Run. Using Cloud Run Metadata Server for authentication.")
	} else if h.ServiceAccountJSON != "" {
		log.Printf("Using Service Account JSON from GCP_SERVICE_ACCOUNT_JSON.")
	} else if os.Getenv("GOOGLE_APPLICATION_CREDENTIALS") != "" {
		log.Printf("Using Google Application Default Credentials (ADC) from file: %s", os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"))
	} else {
		log.Printf("No environment credentials found. Using local gcloud ADC or interactive login.")
	}

	r := gin.Default()
	r.Use(cors.Default())

	r.POST("/api/gcp/auth", h.AuthGCP)
	r.GET("/api/gcp/auth/status", h.GetAuthStatus)
	r.POST("/api/gcp/discover", h.DiscoverGCP)
	r.GET("/api/gcp/resources", h.ListResources)
	r.GET("/api/gcp/managed-resources", h.ListManagedResources)
	r.GET("/api/gcp/resources/active", h.ListActiveResources)
	r.POST("/api/gcp/filter", h.FilterGCP)
	r.POST("/api/gcp/plan", h.PlanTerraform)
	r.POST("/api/gcp/apply", h.ApplyTerraform)
	r.POST("/api/gcp/destroy", h.DestroyTerraform)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	r.Run(":" + port)
}
