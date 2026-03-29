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

---

### 3. Template Engine

- Use Go templates (text/template)
- Store versioned templates
- Generate clean Terraform files


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


