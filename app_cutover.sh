#!/bin/sh
#scirpts for failover for R5 step

# 1. Create the empty unmanaged instance group
gcloud compute instance-groups unmanaged create app-instance-group-secon --zone=asia-south1-b
 
# 2. Add your existing instance to the group
gcloud compute instance-groups unmanaged add-instances app-instance-group-secon --zone=asia-south1-b --instances=my-flask-app-server
 
# 3. Set the named port
gcloud compute instance-groups unmanaged set-named-ports app-instance-group-secon --zone=asia-south1-b --named-ports=http-custom:8081
 
# 1. Create the Backend Service
# Note: You must have the health check created already to reference it here
gcloud compute backend-services create app-backend-service-secon \
    --protocol=HTTP \
    --port-name=http-custom \
    --health-checks=app-health-check \
    --global
 
# 2. Add the Instance Group as a Backend to that service
gcloud compute backend-services add-backend app-backend-service-secon \
    --instance-group=app-instance-group-secon \
    --instance-group-zone=asia-south1-b \
    --global
 
gcloud compute url-maps set-default-service app-url-map \
    --default-service=app-backend-service-secon \
    --global