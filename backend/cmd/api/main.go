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
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found")
	}

	cwd, _ := os.Getwd()
	h := &api.APIHandler{
		DataDir:          filepath.Join(cwd, "data", "gcp"),
		OutputDir:        filepath.Join(cwd, "output"),
		GenSvc:           generator.New(filepath.Join(cwd, "backend", "templates")),
		ImpersonateEmail: os.Getenv("GCP_IMPERSONATE_EMAIL"),
	}

	if h.ImpersonateEmail == "" {
		h.ImpersonateEmail = "tf-service-account@wayfair-test-378605.iam.gserviceaccount.com"
	}
	log.Printf("Using Impersonation Email: %s", h.ImpersonateEmail)

	r := gin.Default()
	r.Use(cors.Default())

	r.POST("/api/gcp/auth", h.AuthGCP)
	r.GET("/api/gcp/auth/status", h.GetAuthStatus)
	r.POST("/api/gcp/discover", h.DiscoverGCP)
	r.GET("/api/gcp/resources", h.ListResources)
	r.GET("/api/gcp/resources/active", h.ListActiveResources)
	r.POST("/api/gcp/filter", h.FilterGCP)
	r.GET("/api/gcp/plan", h.PlanTerraform)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	r.Run(":" + port)
}
