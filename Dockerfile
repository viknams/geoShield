FROM golang:1.26-alpine AS builder

WORKDIR /app

# Copy the go mod and sum files
COPY go.mod go.sum* ./

# Download all dependencies. Dependencies will be cached if the go.mod and go.sum files are not changed
ENV GOPROXY=https://goproxy.io,direct
RUN go mod download

# Copy the source code into the container
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o /api ./backend/cmd/api/main.go

# Final stage
FROM alpine:latest

# Install necessary certificates, Git, and tools required for Terraform
RUN apk --no-cache add ca-certificates tzdata wget unzip git

# Install Terraform
RUN wget https://releases.hashicorp.com/terraform/1.8.2/terraform_1.8.2_linux_amd64.zip && \
    unzip terraform_1.8.2_linux_amd64.zip && \
    mv terraform /usr/local/bin/ && \
    rm terraform_1.8.2_linux_amd64.zip

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /api /api

# Copy necessary files for the application to run
# The backend expects 'backend/templates' and potentially 'data/gcp'
RUN mkdir -p /app/data/gcp
COPY --from=builder /app/backend/templates ./backend/templates

# Expose port 8080 to the outside world
EXPOSE 8080

# Command to run the executable
CMD ["/api"]
