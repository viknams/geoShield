# geoShield

geoShield is a SaaS platform for automated cloud landing zone provisioning on **Google Cloud Platform (GCP)**. It enables organizations to quickly provision production-ready infrastructure using Infrastructure as Code (IaC) with a simplified UI.

---

## 🏗️ Architecture

### **Frontend**
- **Framework:** [Next.js](https://nextjs.org/) (React, TypeScript)
- **Styling:** Tailwind CSS
- **Purpose:** User interface for selecting templates and configuring infrastructure.

### **Backend**
- **Language:** [Go](https://go.dev/)
- **Frameworks:** [Gin](https://gin-gonic.com/) or Fiber for API, [GORM](https://gorm.io/) for DB.
- **Purpose:** Core logic for template rendering, code generation, and Git/Atlantis orchestration.

### **Infrastructure Engine**
- **IaC:** [Terraform](https://www.terraform.io/)
- **Execution:** [Atlantis](https://www.runatlantis.io/)
- **Source of Truth:** Git repositories (GitHub)

---

## 🧩 Key Principles

1. **GitOps First:** Git is the single source of truth for all infrastructure.
2. **Human-Readable IaC:** Generated Terraform code is clean, modular, and editable.
3. **No Vendor Lock-in:** Users retain full ownership and control of their Terraform code.
4. **Simple UX:** A guided experience from zero to production-ready landing zones.

---

## 🚀 Getting Started

### **Prerequisites**
- **Go** (1.21+)
- **Node.js** (18+) & **npm**
- **Docker** (for local testing of MCP/Atlantis)
- **Terraform**

### **Backend Setup**
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   go mod download
   ```
3. Run the API:
   ```bash
   go run cmd/api/main.go
   ```

### **Frontend Setup**
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to see the result.

---

## 🔄 Core Workflow

1. **Configure:** User selects a GCP blueprint (e.g., VPC, GKE) in the UI.
2. **Generate:** Backend renders Go templates into Terraform HCL files.
3. **Commit:** Backend pushes code to the user's Git repo and opens a Pull Request.
4. **Deploy:** Atlantis detects the PR, runs `terraform plan`, and awaits user approval to `apply`.

---

## 📂 Repository Structure

- `/backend`: Go source code, templates, and API handlers.
- `/frontend`: Next.js application.
- `/data`: CSV inputs for resource discovery and filtering.
- `/output`: (Ignored) Local directory for generated Terraform output.
- `project-phase-plan.md`: Current implementation roadmap.
