package generator

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"text/template"
)

type Resource struct {
	Type string      // e.g., "vpc", "vm", "gcs"
	Name string      // Instance name, e.g., "my-vpc-1"
	Data interface{} // Specific configuration for this resource
}

type Config struct {
	Cloud       string // e.g., "gcp", "aws"
	OrgName     string
	FolderName  string
	ProjectName string
	Environment string // e.g., "staging", "prod"
	PathPattern string // e.g., "{{.Cloud}}/{{.OrgName}}/{{.Environment}}/{{.Type}}/{{.Name}}"
	Resources   []Resource
}

type Generator struct {
	TemplateDir string
}

func New(templateDir string) *Generator {
	return &Generator{TemplateDir: templateDir}
}

func (g *Generator) getResourcePath(config Config, res Resource) (string, error) {
	if config.PathPattern == "" {
		// Default fallback
		return filepath.Join(
			config.Cloud,
			config.OrgName,
			config.FolderName,
			config.ProjectName,
			res.Type,
			res.Name,
		), nil
	}

	tmpl, err := template.New("path").Parse(config.PathPattern)
	if err != nil {
		return "", fmt.Errorf("failed to parse path pattern: %w", err)
	}

	data := struct {
		Config
		Resource
	}{config, res}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("failed to execute path pattern: %w", err)
	}

	return buf.String(), nil
}

func (g *Generator) Generate(config Config, outputDir string) (map[string]string, error) {
	generatedFiles := make(map[string]string)

	// 1. Generate Resources
	for _, res := range config.Resources {
		resRelPath, err := g.getResourcePath(config, res)
		if err != nil {
			return nil, err
		}

		resAbsPath := filepath.Join(outputDir, resRelPath)

		if err := os.MkdirAll(resAbsPath, 0755); err != nil {
			return nil, fmt.Errorf("failed to create directory for resource %s: %w", res.Name, err)
		}

		// Load templates for this resource type
		tmplDir := filepath.Join(g.TemplateDir, config.Cloud, res.Type)
		entries, err := os.ReadDir(tmplDir)
		if err != nil {
			return nil, fmt.Errorf("failed to read template directory %s: %w", tmplDir, err)
		}

		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}

			if filepath.Ext(entry.Name()) != ".tmpl" {
				continue
			}

			tmplPath := filepath.Join(tmplDir, entry.Name())
			outFileName := entry.Name()[:len(entry.Name())-5] // Remove .tmpl
			outPath := filepath.Join(resAbsPath, outFileName)

			tmpl, err := template.ParseFiles(tmplPath)
			if err != nil {
				return nil, fmt.Errorf("failed to parse template %s: %w", entry.Name(), err)
			}

			var buf bytes.Buffer
			if err := tmpl.Execute(&buf, res.Data); err != nil {
				return nil, fmt.Errorf("failed to execute template %s: %w", entry.Name(), err)
			}

			content := buf.String()
			if err := os.WriteFile(outPath, []byte(content), 0644); err != nil {
				return nil, fmt.Errorf("failed to write to file %s: %w", outFileName, err)
			}

			// Store using the relative path for Git
			relFilePath := filepath.Join(resRelPath, outFileName)
			generatedFiles[relFilePath] = content
		}
	}

	// 2. Generate common files (like atlantis.yaml at the root)
	commonTmplPath := filepath.Join(g.TemplateDir, "common", "atlantis.yaml.tmpl")
	if _, err := os.Stat(commonTmplPath); err == nil {
		tmpl, err := template.ParseFiles(commonTmplPath)
		if err != nil {
			return nil, fmt.Errorf("failed to parse common template atlantis.yaml: %w", err)
		}

		var buf bytes.Buffer
		if err := tmpl.Execute(&buf, config); err != nil {
			return nil, fmt.Errorf("failed to execute atlantis template: %w", err)
		}

		content := buf.String()
		outPath := filepath.Join(outputDir, "atlantis.yaml")
		if err := os.WriteFile(outPath, []byte(content), 0644); err != nil {
			return nil, fmt.Errorf("failed to write atlantis.yaml: %w", err)
		}
		generatedFiles["atlantis.yaml"] = content
	}

	return generatedFiles, nil
}
