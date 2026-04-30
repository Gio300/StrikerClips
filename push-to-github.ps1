# Push Shinobi Village to GitHub
# Today the live deploy still goes to the StrikerClips repo. When you rename the repo,
# pass -Repo "ShinobiVillage" (and update VITE_BASE_PATH to /ShinobiVillage/).

param(
    [Parameter(Mandatory=$true)]
    [string]$Username,
    [string]$Repo = "StrikerClips"
)

$remote = "https://github.com/$Username/$Repo.git"

Set-Location $PSScriptRoot

& "C:\Program Files\Git\bin\bash.exe" -c "git remote add origin $remote 2>/dev/null || git remote set-url origin $remote"
& "C:\Program Files\Git\bin\bash.exe" -c "git push -u origin main"

Write-Host "Done! Repo: https://github.com/$Username/$Repo"
