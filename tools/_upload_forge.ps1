param([string]$Token, [string]$Tag = 'v0.1.7')
$ErrorActionPreference = 'Stop'
$h = @{ Authorization="Bearer $Token"; 'User-Agent'='x'; Accept='application/vnd.github+json' }

# Get release
$rels = Invoke-RestMethod 'https://api.github.com/repos/Krx-21/beyond-depth-launcher/releases?per_page=10' -Headers $h
$rel = $rels | Where-Object { $_.tag_name -eq $Tag }
if (-not $rel) { throw "release $Tag not found" }
Write-Host "release id=$($rel.id) draft=$($rel.draft) existing assets=$($rel.assets.Count)"

# --- Upload forge-installer.jar ---
$jarSrc = 'C:\Users\godof\Documents\Beyond Depth Sever\forge-installer.jar'
$existJar = $rel.assets | Where-Object { $_.name -eq 'forge-installer.jar' }
if ($existJar) {
    Write-Host "forge-installer.jar already exists (id=$($existJar.id)), skipping upload"
} else {
    $uploadUrl = ($rel.upload_url -replace '\{.*\}$','') + '?name=forge-installer.jar'
    $hh = @{ Authorization="Bearer $Token"; 'User-Agent'='x'; Accept='application/vnd.github+json'; 'Content-Type'='application/octet-stream' }
    Write-Host "Uploading forge-installer.jar ($([Math]::Round((Get-Item $jarSrc).Length/1MB,1)) MB)..."
    $res = Invoke-RestMethod -Uri $uploadUrl -Method Post -Headers $hh -Body ([System.IO.File]::ReadAllBytes($jarSrc)) -TimeoutSec 300
    Write-Host "Uploaded: $($res.name) size=$($res.size)"
}

# --- Re-publish manifest.json (delete old then upload new) ---
$manifestSrc = 'C:\Users\godof\Documents\Beyond Depth Launcher\dist\manifest.json'
$oldManifest = $rel.assets | Where-Object { $_.name -eq 'manifest.json' }
if ($oldManifest) {
    Write-Host "Deleting old manifest.json asset id=$($oldManifest.id)..."
    Invoke-RestMethod "https://api.github.com/repos/Krx-21/beyond-depth-launcher/releases/assets/$($oldManifest.id)" -Method Delete -Headers $h | Out-Null
    Write-Host "Deleted."
}
$manifestUrl = ($rel.upload_url -replace '\{.*\}$','') + '?name=manifest.json'
$hh2 = @{ Authorization="Bearer $Token"; 'User-Agent'='x'; Accept='application/vnd.github+json'; 'Content-Type'='application/json' }
Write-Host "Uploading manifest.json..."
$res2 = Invoke-RestMethod -Uri $manifestUrl -Method Post -Headers $hh2 -Body ([System.IO.File]::ReadAllBytes($manifestSrc)) -TimeoutSec 60
Write-Host "Uploaded: $($res2.name) size=$($res2.size)"

# Ensure release is not draft
$body = @{ draft=$false; name=$Tag; tag_name=$Tag } | ConvertTo-Json
$patched = Invoke-RestMethod "https://api.github.com/repos/Krx-21/beyond-depth-launcher/releases/$($rel.id)" -Method Patch -Headers $hh2 -Body $body
Write-Host "Release draft=$($patched.draft) - DONE"
