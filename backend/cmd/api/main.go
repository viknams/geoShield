package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strconv"

	"time"

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

	// Load users from users.json
	usersFile, err := os.ReadFile(filepath.Join(rootDir, "users.json"))
	if err != nil {
		log.Fatalf("failed to read users.json: %v", err)
	}
	var users map[string]string
	if err := json.Unmarshal(usersFile, &users); err != nil {
		log.Fatalf("failed to parse users.json: %v", err)
	}
	log.Printf("Loaded %d users from users.json", len(users))

	cacheHours, err := strconv.Atoi(os.Getenv("DISCOVERY_CACHE_DURATION_HOURS"))
	if err != nil || cacheHours <= 0 {
		cacheHours = 240 // Default to 10 days (240 hours)
	}
	log.Printf("Discovery cache duration set to %d hours.", cacheHours)

	filterCacheHours, err := strconv.Atoi(os.Getenv("FILTER_CACHE_DURATION_HOURS"))
	if err != nil || filterCacheHours <= 0 {
		filterCacheHours = 72 // Default to 3 days
	}
	log.Printf("Filter cache duration set to %d hours.", filterCacheHours)

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
		CutoverScriptPath:      os.Getenv("APP_CUTOVER_SCRIPT_PATH"),
		// Populate new configurable defaults
		DefaultVMNetwork:        os.Getenv("DEFAULT_VM_NETWORK"),
		DefaultVMSubnetwork:     os.Getenv("DEFAULT_VM_SUBNETWORK"),
		DefaultVMMachineType:    os.Getenv("DEFAULT_VM_MACHINE_TYPE"),
		DefaultVMImage:          os.Getenv("DEFAULT_VM_IMAGE"),
		DefaultBucketLocation:   os.Getenv("DEFAULT_BUCKET_LOCATION"),
		DefaultBucketVersioning: os.Getenv("DEFAULT_BUCKET_VERSIONING") == "true", // Parse as boolean
		DefaultSQLDBVersion:     os.Getenv("DEFAULT_SQL_DB_VERSION"),
		DefaultSQLTier:          os.Getenv("DEFAULT_SQL_TIER"),
		DefaultSQLNetwork:       os.Getenv("DEFAULT_SQL_NETWORK"),
		// Add new SQL default configurations
		DefaultSQLDeletionProtection: os.Getenv("DEFAULT_SQL_DELETION_PROTECTION") == "true",
		DefaultSQLDatabaseName:       os.Getenv("DEFAULT_SQL_DATABASE_NAME"),
		DefaultSQLDBUser:             os.Getenv("DEFAULT_SQL_DB_USER"),
		DefaultSQLDBPassword:         os.Getenv("DEFAULT_SQL_DB_PASSWORD"),
		DefaultSQLBackupBucket:       os.Getenv("SQL_BACKUP_BUCKET"),
		FilterCacheDuration:          time.Duration(filterCacheHours) * time.Hour,
		DiscoveryCacheDuration:       time.Duration(cacheHours) * time.Hour,
		Users:                        users,
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
	// Use a more specific CORS configuration to allow the Authorization header
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowHeaders = append(config.AllowHeaders, "Authorization")
	r.Use(cors.New(config))

	// Group API routes and apply authentication middleware
	v1 := r.Group("/api/gcp")
	v1.Use(h.AuthMiddleware())
	{
		// Authentication
		v1.POST("/auth", h.AuthGCP)
		v1.GET("/auth/status", h.GetAuthStatus)

		// Discovery and Filtering
		v1.POST("/discover", h.DiscoverGCP)
		v1.GET("/discover/status", h.GetDiscoveryStatus)
		v1.GET("/resources", h.ListResources)
		v1.GET("/resources/active", h.ListActiveResources)
		v1.GET("/filter/status", h.GetFilterStatus)
		v1.POST("/filter", h.FilterGCP)

		// Terraform Plan & Apply
		v1.GET("/plan/status", h.GetPlanStatus)
		v1.POST("/plan", h.PlanTerraform)
		v1.POST("/plan/cache/clear", h.ClearPlanCache)
		v1.POST("/apply", h.ApplyTerraform)
		v1.POST("/cancel", h.CancelOperation)

		// Terraform Destroy
		v1.GET("/managed-resources", h.ListManagedResources)
		v1.POST("/destroy/plan", h.PlanDestroyTerraform)
		v1.POST("/destroy", h.DestroyTerraform)

		// Pub/Sub Streaming (Note: WebSocket upgrade might not work with all middleware)
		v1.GET("/stream-pubsub-ws", h.StreamPubSubMessagesWS)

		// Migration
		v1.POST("/migrate", h.AppMigration)
		v1.GET("/migrate/status", h.GetMigrationStatus)

		// Cutover
		v1.POST("/cutover", h.Cutover)
		v1.GET("/cutover/status", h.GetCutoverStatus)

		// Client-side logging
		v1.POST("/log", h.LogFrontendMessage)
	}
	// This endpoint needs to be outside the auth group if it's part of the initial page load before API key is entered.
	// For now, let's keep it inside and ensure API key is always present.
	r.POST("/api/gcp/resources/active/save", h.AuthMiddleware(), h.SaveActiveResourcesSelections)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	r.Run(":" + port)
}
