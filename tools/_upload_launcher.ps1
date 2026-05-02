param([string]$Token = $env:GH_TOKEN, [string]$Tag = 'v0.1.10')
$ErrorActionPreference = 'Stop'
$h = @{ Authorization="Bearer $Token"; 'User-Agent'='x'; Accept='application/vnd.github+json' }
$rel = (Invoke-RestMethod "https://api.github.com/repos/Krx-21/beyond-depth-launcher/releases?per_page=10" -Headers $h) | Where-Object { $_.tag_name -eq $Tag }
if (-not $rel) { throw "release $Tag not found" }
$uploadBase = ($rel.upload_url -replace '\{.*\}$','')
$existing = @{}
foreach ($a in $rel.assets) { $existing[$a.name] = $a.id }
Write-Host "Release id=$($rel.id) existing assets=$($existing.Count)"

$files = @(
  'C:\Users\godof\Documents\Beyond Depth Launcher\dist\Beyond Depth Launcher Setup 0.1.10.exe',
  'C:\Users\godof\Documents\Beyond Depth Launcher\dist\Beyond Depth Launcher Setup 0.1.10.exe.blockmap',
  'C:\Users\godof\Documents\Beyond Depth Launcher\dist\latest.yml'
)

foreach ($f in $files) {
  $name = [System.IO.Path]::GetFileName($f)
  $sanitized = ($name -replace '[^A-Za-z0-9._+-]', '.')
  $deleted = @{}
  foreach ($n in @($name, $sanitized)) {
    if ($existing.ContainsKey($n) -and -not $deleted.ContainsKey($existing[$n])) {
      Write-Host "Deleting old asset: $n (id=$($existing[$n]))"
      Invoke-RestMethod "https://api.github.com/repos/Krx-21/beyond-depth-launcher/releases/assets/$($existing[$n])" -Method Delete -Headers $h | Out-Null
      $deleted[$existing[$n]] = $true
    }
  }
  $sz = (Get-Item -LiteralPath $f).Length
  $url = $uploadBase + "?name=$([uri]::EscapeDataString($name))"
  $ct = if ($f -match '\.yml$') { 'text/yaml' } else { 'application/octet-stream' }
  $hh = @{ Authorization="Bearer $Token"; 'User-Agent'='x'; Accept='application/vnd.github+json'; 'Content-Type'=$ct }
  Write-Host "Uploading $name ($([Math]::Round($sz/1MB,1)) MB)..."
  $r = Invoke-RestMethod -Uri $url -Method Post -Headers $hh -Body ([System.IO.File]::ReadAllBytes($f)) -TimeoutSec 300
  Write-Host "  OK name=$($r.name) size=$($r.size)"
}
Write-Host "All done."
