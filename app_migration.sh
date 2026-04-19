#!/bin/bash
 
# --- Configuration ---
PROJECT_ID="geoshield-demo"
SOURCE_INSTANCE="lib-instance"
DEST_INSTANCE="my-lib-instance"
DB_NAME="library_db"
BUCKET_NAME="pgsql-backup-dem0"
DUMP_FILE="library_db_export_$(date +%Y%m%d_%H%M%S).sql"
 
echo "Starting migration for $DB_NAME..."
 
# 1. Export from Source Instance to GCS
echo "Step 1: Exporting $DB_NAME from $SOURCE_INSTANCE to gs://$BUCKET_NAME/$DUMP_FILE..."
gcloud sql export sql $SOURCE_INSTANCE gs://$BUCKET_NAME/$DUMP_FILE \
    --database=$DB_NAME \
    --project=$PROJECT_ID

DEST_SA=$(gcloud sql instances describe $DEST_INSTANCE --format="value(serviceAccountEmailAddress)")

# Ensure Source can Write
gcloud storage buckets add-iam-policy-binding gs://$BUCKET_NAME \
    --member="serviceAccount:$DEST_SA" --role="roles/storage.objectAdmin" --quiet


sleep 20
echo "waiting 20 second ....."

echo "Step 1.5: Resetting destination database..."
gcloud sql databases delete $DB_NAME --instance=$DEST_INSTANCE --quiet

sleep 5
gcloud sql databases create $DB_NAME --instance=$DEST_INSTANCE --quiet

# 2. Import into Destination Instance from GCS
# Note: Ensure the 'library_db' exists on the destination instance first.
echo "Step 2: Importing into $DEST_INSTANCE..."
gcloud sql import sql $DEST_INSTANCE gs://$BUCKET_NAME/$DUMP_FILE \
    --database=$DB_NAME \
    --project=$PROJECT_ID \
    --quiet
 
# 3. Cleanup (Optional)
# echo "Step 3: Cleaning up GCS file..."
# gsutil rm gs://$BUCKET_NAME/$DUMP_FILE
 
echo "Migration Complete!"