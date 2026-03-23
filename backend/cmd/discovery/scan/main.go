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
	projectID := flag.String("project", "", "GCP Project ID to discover resources from")
	outputDir := flag.String("output", "data/gcp", "Directory to save CSV files")
	impersonate := flag.String("impersonate", "", "Service account to impersonate")
	flag.Parse()

	if *projectID == "" {
		log.Fatal("Project ID is required. Use -project flag.")
	}

	// Load .env for credentials if needed
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found")
	}

	ctx := context.Background()
	svc, err := discovery.NewDiscoveryService(ctx, *projectID, *impersonate)
	if err != nil {
		log.Fatalf("failed to initialize discovery service: %v", err)
	}

	// Ensure output directory exists
	cwd, _ := os.Getwd()
	absOutputDir := filepath.Join(cwd, *outputDir)
	if err := os.MkdirAll(absOutputDir, 0755); err != nil {
		log.Fatalf("failed to create output directory: %v", err)
	}

	log.Printf("Starting discovery for project: %s", *projectID)
	if err := svc.Discover(ctx, absOutputDir); err != nil {
		log.Fatalf("discovery failed: %v", err)
	}

	log.Printf("Discovery completed. CSV files saved to %s", absOutputDir)
}
