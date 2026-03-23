# Gemini CLI: Terraform MCP Agent Rules

## Architectural Rules
- **Agent Execution:** Never call `.run()` directly on an `LlmAgent` instance. Always wrap `LlmAgent` instances in a `Runner` (typically `InMemoryRunner` for local testing).
- **MCP Integration:** This project relies on the `hashicorp/terraform-mcp-server` running via Docker. Ensure Docker is active before execution.
- **Human-in-the-Loop:** Always implement explicit user confirmation for `terraform apply` commands within tool definitions.

## Implementation Guide (Fixing the 'LlmAgent' Error)
To execute the agent correctly, use the `InMemoryRunner` from `google.adk.runners`:



## Project-Specific Context
# Create the GEMINI.md file with Go backend updated

content = """# GEMINI.md

## 🧠 Project Overview

We are building a SaaS platform for automated cloud landing zone provisioning.

The platform enables:
- Startups, enterprises, and organizations  
- To quickly provision production-ready cloud infrastructure  
- Using Infrastructure as Code (IaC)

The system uses:
- Terraform as the IaC engine  
- Atlantis as the execution engine  
- Git repositories as the source of truth  

---

## 🎯 Core Product Vision

“Enable users to go from zero → production-ready cloud infrastructure using a simple UI, while maintaining full ownership of Terraform code.”

---

## 🧩 Key Principles

1. Git is the source of truth  
2. Terraform code must always be human-readable and editable  
3. Users retain full control of infrastructure  
4. System should be GitOps-first  
5. No vendor lock-in  
6. UX should be simple and guided  

---

## ⚙️ System Architecture

### High-Level Flow

1. User interacts with SaaS UI  
2. User selects a template (blueprint)  
3. User provides configuration  
4. Backend generates Terraform code  
5. Code is pushed to user Git repository (via PR)  
6. Atlantis detects PR and runs init/plan/apply  (after user approval)
7. Infrastructure is created in user’s cloud  

---

## 🏗️ Core Components

### 1. Frontend (UI)
- React
- Next.js
- Tailwind CSS

---

### 2. Backend (Control Plane - Go)

Language: Go

Frameworks/Libraries:
- Gin (HTTP framework) OR Fiber
- GORM or SQLX for DB access

Responsibilities:
- User & org management  
- Template rendering  
- Terraform code generation  
- Git operations (PR, commits)  
- Webhook processing (Git + Atlantis)  
- Orchestration logic  

---

### 3. Template Engine

- Use Go templates (text/template)
- Store versioned templates
- Generate clean Terraform files

---

### 4. Git Integration Layer

- GitHub App integration
- Features:
  - Repo connection  
  - Branch creation  
  - PR creation  
  - Commit Terraform code  
  - Commit atlantis.yaml  

---

### 5. Atlantis Integration

- SaaS does NOT run Terraform
- Atlantis executes plan/apply

Backend must:
- Generate atlantis.yaml
- Listen to Atlantis webhooks
- Track deployment status

---

### 6. Webhook System

Handle:
- GitHub events (PR opened, merged)
- Atlantis events (plan/apply status)

Must be:
- Reliable
- Idempotent
- Retry-capable

---

## 🔄 Deployment Workflow

1. User selects template  
2. User configures inputs  
3. Backend generates Terraform code  
4. Backend pushes code to Git repo  
5. Backend opens PR  
6. Atlantis runs plan  
7. User reviews and approves  
8. Atlantis applies changes  
9. SaaS updates status  

---

## 🧱 Terraform Structure

/infra
  main.tf
  variables.tf
  outputs.tf

/modules
  vpc/
  compute/
  database/

Rules:
- Modular design  
- No hardcoding  
- Clean readable code  

---

## 📄 Atlantis Configuration

Each repo must include:

atlantis.yaml

Example:

version: 3
projects:
  - dir: .
    autoplan:
      when_modified: ["*.tf"]
      enabled: true

---

## 🗄️ Database

- PostgreSQL

Store:
- Users  
- Organizations  
- Projects  
- Environments  
- Deployment history  

---

## ⚡ Background Jobs

- Redis
- Asynq (Go-based queue) OR go-workers

Use for:
- Repo setup  
- Code generation  
- Webhook processing  
- Retry logic  

---

## 🔐 Authentication & Security

- OAuth via GitHub App  
- RBAC (role-based access control)  
- Do NOT store cloud credentials  

---

## ☁️ Hosting

- AWS

Services:
- EC2 or ECS (backend)
- RDS (PostgreSQL)
- S3 (storage)
- ElastiCache (Redis)

---

## 🧪 MVP Scope

- AWS only  
- GitHub only  
- Atlantis integration  
- 2–3 templates  
- Basic UI  
- PR-based workflow  

---

## 🚫 Out of Scope

- Multi-cloud  
- Kubernetes execution  
- Advanced policy engine  
- Cost optimization  

---

## 🧠 AI Behavior Rules

1. Prefer simplicity  
2. Use idiomatic Go code  
3. Keep services modular  
4. Follow clean architecture  
5. Avoid over-engineering  
6. Ensure scalability  
7. Always generate readable Terraform  

---

## 📈 Future Enhancements

- Multi-cloud  
- GitLab support  
- CI/CD execution mode  
- Drift detection  
- Cost insights  

---

## 🧭 Summary

This SaaS platform is:
- A control plane for cloud infrastructure  
- Built on Terraform + Git + Atlantis  
- Backend powered by Go  
- Focused on automation, simplicity, and user ownership  


