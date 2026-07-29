# =============================================================================
# deploy-worker.ps1 " build + deploy the TKO render worker as a Cloud Run Job
# and a Cloud Scheduler tick. Self-discovers the DB env from the running
# `killcam` service so you don't hand-copy anything. No secrets live in this
# file; YouTube + DB creds come from Secret Manager.
#
#   ./deploy-worker.ps1                 # build, deploy job, create/refresh schedule
#   ./deploy-worker.ps1 -RunOnce        # also execute the job once and wait
#   ./deploy-worker.ps1 -EveryMinutes 10
# =============================================================================
param(
  [string]$Project   = "reelone-498406",
  [string]$Region    = "us-central1",
  [string]$Service   = "killcam",              # the running web app (env source)
  [string]$Job       = "tko-render-worker",
  [int]   $EveryMinutes = 5,
  [switch]$RunOnce
)
$ErrorActionPreference = "Stop"
$Image = "us-central1-docker.pkg.dev/$Project/killcam/tko-render-worker:latest"
$YtClientId = "464229950644-14thoufr97qrg78gjrv9uir7c81karnj.apps.googleusercontent.com"

Write-Host "== Discovering DB env from '$Service' ==" -ForegroundColor Cyan
$svc = gcloud run services describe $Service --region $Region --project $Project --format json | ConvertFrom-Json
$env0 = $svc.spec.template.spec.containers[0].env
function Val($name) { ($env0 | Where-Object { $_.name -eq $name }).value }
function SecretRef($name) {
  $e = $env0 | Where-Object { $_.name -eq $name }
  if ($e -and $e.valueFrom) { "$($e.valueFrom.secretKeyRef.name):$($e.valueFrom.secretKeyRef.key)" } else { $null }
}
$cloudsql = ($svc.spec.template.metadata.annotations.'run.googleapis.com/cloudsql-instances')
$instConn = Val "INSTANCE_CONNECTION_NAME"; if (-not $instConn) { $instConn = $cloudsql }
$dbName   = Val "DB_NAME";  if (-not $dbName)  { $dbName  = "killcam" }
$dbUser   = Val "DB_USER";  if (-not $dbUser)  { $dbUser  = "postgres" }
$dbPassSecret = SecretRef "DB_PASSWORD"; if (-not $dbPassSecret) { $dbPassSecret = "reelone-app-db-password:latest" }
$saEmail  = $svc.spec.template.spec.serviceAccountName
Write-Host "  cloudsql=$cloudsql  db=$dbName user=$dbUser  db-secret=$dbPassSecret  sa=$saEmail"

Write-Host "== Building worker image ==" -ForegroundColor Cyan
gcloud artifacts repositories create killcam --repository-format=docker --location=$Region --project $Project 2>$null
gcloud builds submit --config cloudbuild.worker.yaml --substitutions "_IMAGE=$Image" --project $Project .

Write-Host "== Deploying Cloud Run Job ==" -ForegroundColor Cyan
$envVars = "INSTANCE_CONNECTION_NAME=$instConn,DB_NAME=$dbName,DB_USER=$dbUser,YOUTUBE_CLIENT_ID=$YtClientId"
$secrets = "DB_PASSWORD=$dbPassSecret,YOUTUBE_CLIENT_SECRET=youtube-client-secret:latest,YOUTUBE_REFRESH_TOKEN=youtube-refresh-token:latest"
$exists = (gcloud run jobs list --region $Region --project $Project --format "value(name)") -match "^$Job$"
$verb = if ($exists) { "update" } else { "create" }
gcloud run jobs $verb $Job `
  --image $Image --region $Region --project $Project `
  --set-cloudsql-instances $cloudsql `
  --set-env-vars $envVars `
  --set-secrets $secrets `
  --memory 2Gi --cpu 2 --task-timeout 3600 --max-retries 1

Write-Host "== Scheduling every $EveryMinutes min ==" -ForegroundColor Cyan
$tick = "$Job-tick"
$uri  = "https://$Region-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$Project/jobs/$Job`:run"
$schedExists = (gcloud scheduler jobs list --location $Region --project $Project --format "value(name)") -match "$tick$"
$sverb = if ($schedExists) { "update" } else { "create" }
gcloud scheduler jobs $sverb http $tick `
  --location $Region --project $Project `
  --schedule "*/$EveryMinutes * * * *" `
  --uri $uri --http-method POST `
  --oauth-service-account-email $saEmail

if ($RunOnce) {
  Write-Host "== Executing once ==" -ForegroundColor Cyan
  gcloud run jobs execute $Job --region $Region --project $Project --wait
}
Write-Host "Done. The worker now drains render_jobs on its own." -ForegroundColor Green

