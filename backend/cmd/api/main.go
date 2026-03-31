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
		PubSubServiceAccountJSON:  os.Getenv("PUBSUB_SERVICE_ACCOUNT_JSON"),
		TerraformFolderName:       os.Getenv("TERRAFORM_FOLDER_NAME"),
		ResourcePrefix:            os.Getenv("TERRAFORM_RESOURCE_PREFIX"),
		TerraformCriticalResource: os.Getenv("TERRAFORM_CRITICAL_RESOURCE"),
		// Add new config values from .env
		PubSubTopic:            os.Getenv("PUBSUB_STREAMING_TOPIC"),
		PubSubSubPrefix:        os.Getenv("PUBSUB_SUBSCRIPTION_PREFIX"),
		PubSubLatestMsgSub:     os.Getenv("PUBSUB_LATEST_MSG_SUB"),
		TerraformModuleVersion: os.Getenv("TERRAFORM_MODULE_VERSION"),
		ManagedByLabel:         os.Getenv("MANAGED_BY_LABEL"),
		DefaultRegion:          os.Getenv("DEFAULT_GCP_REGION"),
		AppMigrationScriptPath: os.Getenv("APP_MIGRATION_SCRIPT_PATH"),
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

	// Authentication
	r.POST("/api/gcp/auth", h.AuthGCP)
	r.GET("/api/gcp/auth/status", h.GetAuthStatus)

	// Discovery and Filtering
	r.POST("/api/gcp/discover", h.DiscoverGCP)
	r.GET("/api/gcp/discover/status", h.GetDiscoveryStatus)
	r.GET("/api/gcp/resources", h.ListResources)
	r.GET("/api/gcp/resources/active", h.ListActiveResources)
	r.GET("/api/gcp/filter/status", h.GetFilterStatus)
	r.POST("/api/gcp/filter", h.FilterGCP)

	// Terraform Plan & Apply
	r.GET("/api/gcp/plan/status", h.GetPlanStatus)
	r.POST("/api/gcp/plan", h.PlanTerraform)
	r.POST("/api/gcp/apply", h.ApplyTerraform)
	r.POST("/api/gcp/cancel", h.CancelOperation) // Add the new cancel route

	// Terraform Destroy
	r.GET("/api/gcp/managed-resources", h.ListManagedResources) // Renamed from /plan-destroy in some versions
	r.POST("/api/gcp/destroy/plan", h.PlanDestroyTerraform)
	r.POST("/api/gcp/destroy", h.DestroyTerraform)

	// Pub/Sub Streaming
	r.GET("/api/gcp/stream-pubsub-ws", h.StreamPubSubMessagesWS)
	r.GET("/api/gcp/latest-pubsub-message", h.GetLatestPubSubMessage)

	// Add these two new routes for the migration endpoint
	r.POST("/api/gcp/migrate", h.AppMigration)
	r.GET("/api/gcp/migrate/status", h.GetMigrationStatus)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	r.Run(":" + port)
}
