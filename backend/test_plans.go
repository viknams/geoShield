package main

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	files, err := filepath.Glob("../data/gcp/active-resources/*.csv")
	if err != nil {
		log.Fatal(err)
	}

	for _, file := range files {
		f, err := os.Open(file)
		if err != nil {
			log.Fatal(err)
		}
		rows, err := csv.NewReader(f).ReadAll()
		f.Close()
		
		if len(rows) < 2 {
			continue
		}

		serviceType := strings.TrimSuffix(filepath.Base(file), ".csv")
		
		payload := map[string][][]string{
			serviceType: rows,
		}
		
		jsonData, _ := json.Marshal(payload)
		
		fmt.Printf("\nTesting %s...\n", serviceType)
		resp, err := http.Post("http://127.0.0.1:8080/api/gcp/plan?project=your-project-id", "application/json", bytes.NewBuffer(jsonData))
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			continue
		}
		
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		
		var result map[string]interface{}
		json.Unmarshal(body, &result)
		
		if planOutput, ok := result["plan_output"].(string); ok {
			if strings.Contains(planOutput, "Error") || strings.Contains(planOutput, "No supported resources selected") {
			    fmt.Printf("Result for %s: Has Errors/Unsupported\n%s\n", serviceType, planOutput)
			} else {
			    fmt.Printf("Result for %s: SUCCESS\n", serviceType)
			}
		} else {
			fmt.Printf("Result for %s: %s\n", serviceType, string(body))
		}
	}
}
