# Push StrikerClips to GitHub
# 1. Create a new repo at https://github.com/new named "StrikerClips" (or your choice)
# 2. Run this script, replacing YOUR_USERNAME with your GitHub username

param(
    [Parameter(Mandatory=$true)]
    [string]$Username
)

$repo = "StrikerClips"
$remote = "https://github.com/$Username/$repo.git"

Set-Location $PSScriptRoot

& "C:\Program Files\Git\bin\bash.exe" -c "git remote add origin $remote 2>/dev/null || git remote set-url origin $remote"
& "C:\Program Files\Git\bin\bash.exe" -c "git push -u origin main"

Write-Host "Done! Repo: https://github.com/$Username/$repo"
