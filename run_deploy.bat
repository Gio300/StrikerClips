@echo off
cd /d "C:\Users\Flying Phoenix PCs\Desktop\StrikerClips"
call gcloud run deploy killcam --source . --region us-central1 --project reelone-498406 --quiet > deploy.log 2>&1
echo DEPLOY_EXIT %ERRORLEVEL% >> deploy.log
