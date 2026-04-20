#!/bin/bash
set -e
 
echo "=============================="
echo "🚀 Starting GeoShield Services"
echo "=============================="
 
APP_DIR="/app/geoShield"
BACKEND_PORT=8080
FRONTEND_PORT=80
 
echo "🔪 Releasing ports..."
 
fuser -k ${BACKEND_PORT}/tcp 2>/dev/null || true
fuser -k ${FRONTEND_PORT}/tcp 2>/dev/null || true
 
sleep 2
 
# =========================
# 🚀 Backend
# =========================
echo "⚙️ Starting Backend..."

#export GCP_IMPERSONATE_EMAIL=`gcloud auth list --filter=status:ACTIVE --format="value(account)"`

# export GCP_IMPERSONATE_EMAIL=tfe-svc@gemini-poc-presales.iam.gserviceaccount.com

cd ${APP_DIR}/backend || exit
 
#go build -o app cmd/api/main.go
nohup go run cmd/api/main.go > ${APP_DIR}/backend/backend.log 2>&1 &
 
echo "✅ Backend running on port ${BACKEND_PORT}"
 
# =========================
# 🌐 Frontend
# =========================
echo "⚙️ Starting Frontend..."
 
cd ${APP_DIR}/frontend || exit
 
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm ci --omit=dev
fi

PUBLIC_IP=$(curl -s ifconfig.me)

# BEST: use localhost (stable)
export NEXT_PUBLIC_API_URL=http://${PUBLIC_IP}:${BACKEND_PORT} 
export NEXT_PUBLIC_WS_URL=ws://${PUBLIC_IP}:${BACKEND_PORT} 

npm run build
 
nohup npm start -- --port ${FRONTEND_PORT}> ${APP_DIR}/frontend/frontend.log 2>&1 &
 
echo "✅ Frontend running on port ${FRONTEND_PORT}"
 
 
# =========================
# 🌐 Show Public Access URL
# =========================
PUBLIC_IP=$(curl -s ifconfig.me)
 
echo "🌍 Access your app at:"
echo "http://${PUBLIC_IP}:${FRONTEND_PORT}"
 
echo "=============================="
echo "🎉 GeoShield Started Successfully!"
echo "=============================="