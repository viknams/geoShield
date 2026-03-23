# GCP-First SaaS Implementation Plan

This document outlines the phased implementation plan for the Go-based SaaS platform that automates the provisioning of Google Cloud Platform landing zones.

### Phase 1: Core Backend & Project Setup (Go on GCP)
1.  **Initialize Go Project:** Set up the Go module (`go mod init`) and create the initial directory structure for our backend.
2.  **Set up Web Server:** Implement a basic HTTP server using Gin to handle API requests. This will be containerized for deployment to **Cloud Run**.
3.  **Define Database Models:** Create the GORM models for `User`, `Organization`, and `Project`.
4.  **Database Connection:** Implement the logic to connect to a **Cloud SQL for PostgreSQL** instance.
5.  **GitHub Authentication:** Implement the OAuth flow for user login.

### Phase 2: Code Generation (GCP FAST) & Git Integration
1.  **Template Engine:** Create a Go template that generates HCL for a foundational GCP resource, leveraging a **Cloud Foundation Fabric (FAST)** module (e.g., the VPC network module).
2.  **Code Generator Service:** Implement the service that renders the template into `main.tf`, `variables.tf`, etc.
3.  **Git Integration Service:** Implement the service to commit the generated code and `atlantis.yaml` to a new branch and open a pull request.

### Phase 3: Frontend Scaffolding & API-UI Integration
1.  **Initialize Frontend Project:** Set up a Next.js project with Tailwind CSS.
2.  **Create UI Form:** Build a React form for configuring the GCP VPC template (e.g., project ID, network name).
3.  **Connect UI to Backend:** Wire the form to the Go backend API to trigger the code generation workflow.

### Phase 4: Webhook Handling for Status Updates
1.  **Create Webhook Endpoint:** Add a secure endpoint on our Cloud Run service to receive webhooks from Atlantis.
2.  **Handle Atlantis Webhooks:** Implement a handler to process `plan` and `apply` status updates.
