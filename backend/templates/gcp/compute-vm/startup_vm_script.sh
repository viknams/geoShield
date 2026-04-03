#!/bin/bash
set -e

# 1. Install dependencies
# We use -qq to keep the logs clean and non-interactive
apt-get update
apt-get install -y git python3-pip python3-venv

# 2. Clone the application repository
# If the directory already exists (on reboot), we skip cloning
if [ ! -d "/app" ]; then
  git clone https://github.com/arnabgcp/SampleApp.git /app
fi
cd /app

# 3. Create the .env file from Terraform variables
mkdir -p instance
cat <<EOF > /app/instance/.env
DB_USER=
DB_PASS="pass-vikram"
DB_NAME="db-vikram"
INSTANCE_CONNECTION_NAME="connection-string"
EOF

# 4. Set permissions
chmod +x /app/run.sh

# 5. Create the systemd service unit
# This ensures the app runs continuously and restarts on failure/reboot
cat <<EOF > /etc/systemd/system/sample-app.service
[Unit]
Description=GCP Sample Application
After=network.target
[Service]
Type=simple
User=root
WorkingDirectory=/app
EnvironmentFile=/app/instance/.env
ExecStart=/bin/bash /app/run.sh
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
[Install]
WantedBy=multi-user.target
EOF

# 6. Enable and start the service
systemctl daemon-reload
systemctl enable sample-app.service
systemctl start sample-app.service
