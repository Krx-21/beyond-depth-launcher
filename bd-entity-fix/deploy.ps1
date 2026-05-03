$ErrorActionPreference = 'Stop'
$Token = $env:GH_TOKEN
if (-not $Token) { throw "GH_TOKEN not set" }
$ReleaseId = 316727293
$uploadBase = "https://uploads.github.com/repos/Krx-21/beyond-depth-launcher/releases/$ReleaseId/assets"
$hUpload = @{ Authorization = "Bearer $Token"; 'User-Agent' = 'BeyondDepthUploader'; Accept = 'application/vnd.github+json'; 'Content-Type' = 'application/octet-stream' }
$hApi = @{ Authorization = "Bearer $Token"; 'User-Agent' = 'BeyondDepthUploader'; Accept = 'application/vnd.github+json' }

$jarPath = "C:\Users\godof\Documents\Beyond Depth Launcher\bd-entity-fix\dist\bdentityfix-1.0.0.jar"
$manifestPath = "C:\Users\godof\Documents\Beyond Depth Launcher\dist\manifest.json"

# Check if jar already uploaded
$rel = Invoke-RestMethod "https://api.github.com/repos/Krx-21/beyond-depth-launcher/releases/$ReleaseId" -Headers $hApi
$jarAsset = $rel.assets | Where-Object { $_.name -eq 'bdentityfix-1.0.0.jar' }
if ($jarAsset) {
  Write-Host "Jar already uploaded id=$($jarAsset.id), deleting first..."
  Invoke-RestMethod -Uri "https://api.github.com/repos/Krx-21/beyond-depth-launcher/releases/assets/$($jarAsset.id)" -Method Delete -Headers $hApi
}
$manifestAsset = $rel.assets | Where-Object { $_.name -eq 'manifest.json' }
if ($manifestAsset) {
  Write-Host "Deleting old manifest asset id=$($manifestAsset.id)..."
  Invoke-RestMethod -Uri "https://api.github.com/repos/Krx-21/beyond-depth-launcher/releases/assets/$($manifestAsset.id)" -Method Delete -Headers $hApi
}

Write-Host "Uploading jar..."
$bytes1 = [System.IO.File]::ReadAllBytes($jarPath)
$r1 = Invoke-RestMethod -Uri "$uploadBase`?name=bdentityfix-1.0.0.jar" -Method Post -Headers $hUpload -Body $bytes1 -TimeoutSec 600
Write-Host "Jar uploaded: id=$($r1.id) size=$($r1.size)"

Write-Host "Uploading manifest..."
$bytes2 = [System.IO.File]::ReadAllBytes($manifestPath)
$r2 = Invoke-RestMethod -Uri "$uploadBase`?name=manifest.json" -Method Post -Headers $hUpload -Body $bytes2 -TimeoutSec 600
Write-Host "Manifest uploaded: id=$($r2.id) size=$($r2.size)"

Write-Host "DONE"
