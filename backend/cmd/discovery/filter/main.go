package main

import (
	"context"
	"flag"
	"log"
	"os"
	"path/filepath"

	"example.com/geoShield/backend/internal/discovery"
	"github.com/joho/godotenv"
)

func main() {
	projectID := flag.String("project", "", "GCP Project ID to filter resources from")
	dataDir := flag.String("data", os.Getenv("DATA_DIR_GCP"), "Directory containing discovered CSV files")
	impersonate := flag.String("impersonate", "", "Service account to impersonate")
	flag.Parse()

	if *projectID == "" {
		log.Fatal("Project ID is required. Use -project flag.")
	}

	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found")
	}

	ctx := context.Background()
	svc, err := discovery.NewFilterService(ctx, *projectID, *impersonate, os.Getenv("GCP_SERVICE_ACCOUNT_JSON"))
	if err != nil {
		log.Fatalf("failed to initialize filter service: %v", err)
	}

	cwd, _ := os.Getwd()
	absDataDir := filepath.Join(cwd, *dataDir)

	log.Printf("Starting filtering and consolidation for project: %s", *projectID)
	if err := svc.FilterAndConsolidate(ctx, absDataDir, func(status string) {
		log.Println(status)
	}); err != nil {
		log.Fatalf("filtering failed: %v", err)
	}

	log.Printf("Filtering completed. Unified file saved to %s/active_important_resources.csv", absDataDir)
}
