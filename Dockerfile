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

# Install necessary certificates
RUN apk --no-cache add ca-certificates tzdata

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
