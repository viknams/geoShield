package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"example.com/geoShield/backend/internal/generator"
	"example.com/geoShield/backend/internal/git"
	"github.com/joho/godotenv"
)

func main() {
	// Load .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, relying on environment variables")
	}

	cwd, err := os.Getwd()
	if err != nil {
		log.Fatalf("failed to get current directory: %v", err)
	}

	templateDir := filepath.Join(cwd, "backend", "templates")
	outputDir := filepath.Join(cwd, "output")

	gen := generator.New(templateDir)

	type VPCData struct {
		ProjectID   string
		NetworkName string
		Region      string
		FastRef     string
		Subnets     []struct {
			Name   string
			Region string
			CIDR   string
		}
	}

	vpcData := VPCData{
		ProjectID:   "my-gcp-project",
		NetworkName: "my-vpc-1",
		Region:      "europe-west1",
		FastRef:     "v34.1.0",
		Subnets: []struct {
			Name   string
			Region string
			CIDR   string
		}{
			{
				Name:   "subnet-1",
				Region: "europe-west1",
				CIDR:   "10.0.1.0/24",
			},
		},
	}

	// Example 1: Default Fallback
	configDefault := generator.Config{
		Cloud:       "gcp",
		OrgName:     "my-org",
		FolderName:  "my-folder",
		ProjectName: "my-project",
		Resources: []generator.Resource{
			{
				Type: "vpc",
				Name: "default-vpc",
				Data: vpcData,
			},
		},
	}

	// Example 2: Custom Path Pattern
	configCustom := generator.Config{
		Cloud:       "gcp",
		OrgName:     "enterprise-corp",
		Environment: "production",
		ProjectName: "core-infra",
		PathPattern: "infra/{{.Environment}}/{{.ProjectName}}/{{.Type}}/{{.Name}}",
		Resources: []generator.Resource{
			{
				Type: "vpc",
				Name: "custom-vpc",
				Data: vpcData,
			},
		},
	}

	// Generate Example 1
	log.Println("Generating with default structure...")
	_, err = gen.Generate(configDefault, outputDir)
	if err != nil {
		log.Fatalf("failed to generate default: %v", err)
	}

	// Generate Example 2
	log.Println("Generating with custom path pattern...")
	files, err := gen.Generate(configCustom, outputDir)
	if err != nil {
		log.Fatalf("failed to generate custom: %v", err)
	}

	log.Printf("Code generated successfully in %s", outputDir)

	// Git Integration (using files from the custom run)
	token := os.Getenv("GITHUB_TOKEN")
	owner := os.Getenv("GITHUB_OWNER")
	repo := os.Getenv("GITHUB_REPO")
	token = strings.Trim(token, "\"")
	owner = strings.Trim(owner, "\"")
	repo = strings.Trim(repo, "\"")

	if token == "" || owner == "" || repo == "" {
		log.Printf("\n[NOTICE] Missing Git configuration for PR creation")
		return
	}

	githubService := git.NewGitHubService(token, owner, repo)
	branchName := fmt.Sprintf("infra-flexible-paths-%d", time.Now().Unix())

	var commitFiles []git.CommitFile
	for path, content := range files {
		commitFiles = append(commitFiles, git.CommitFile{
			Path:    path,
			Content: content,
		})
	}

	log.Printf("Creating Pull Request on %s/%s...", owner, repo)
	pr, err := githubService.CreatePullRequest(
		context.Background(),
		branchName,
		"master",
		"feat: dynamic folder structure",
		"This PR demonstrates flexible folder hierarchy using PathPattern templates.",
		commitFiles,
	)

	if err != nil {
		log.Fatalf("failed to create pull request: %v", err)
	}

	log.Printf("Pull request created successfully: %s", pr.GetHTMLURL())
}
