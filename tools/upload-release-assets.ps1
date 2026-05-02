param(
  [string]$Owner = 'Krx-21',
  [string]$Repo  = 'beyond-depth-launcher',
  [string]$Tag   = 'v0.1.9',
  [string]$ListFile = 'C:\Users\godof\Documents\Beyond Depth Launcher\dist\upload-list.txt',
  [string]$Token = $env:GH_TOKEN
)

if (-not $Token) { throw "Set `$env:GH_TOKEN or pass -Token" }
if (-not (Test-Path $ListFile)) { throw "List file not found: $ListFile" }

$headers = @{
  Authorization = "Bearer $Token"
  'User-Agent'  = 'BeyondDepthUploader'
  Accept        = 'application/vnd.github+json'
}

# 1. Get release id (search drafts too)
$all = Invoke-RestMethod "https://api.github.com/repos/$Owner/$Repo/releases?per_page=100" -Headers $headers
$rel = $all | Where-Object { $_.tag_name -eq $Tag } | Select-Object -First 1
if (-not $rel) { throw "No release with tag $Tag (drafts included). Run npm run publish first." }
$releaseId = $rel.id
$uploadBase = ($rel.upload_url -replace '\{.*\}$','')
$existing = @{}
foreach ($a in $rel.assets) { $existing[$a.name] = $a.id }
Write-Host "Release id=$releaseId tag=$Tag draft=$($rel.draft) existing assets=$($existing.Count)"

# 2. Upload files
$files = Get-Content $ListFile | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
Write-Host "Uploading $($files.Count) files..."

$i = 0; $skipped = 0; $uploaded = 0; $failed = 0
# Must match generate-manifest.js sanitizeAssetName():
# GitHub replaces any non [A-Za-z0-9._+-] with '.' AND collapses consecutive dots.
function Get-SanitizedName([string]$n) {
  return (($n -replace '[^A-Za-z0-9._+-]', '.') -replace '\.+', '.')
}
foreach ($f in $files) {
  $i++
  $name = [System.IO.Path]::GetFileName($f)
  $sanitized = Get-SanitizedName $name
  if ($existing.ContainsKey($name) -or $existing.ContainsKey($sanitized)) {
    Write-Host "[$i/$($files.Count)] SKIP $name (exists)"
    $skipped++
    continue
  }
  $sz = (Get-Item -LiteralPath $f).Length
  # Upload using the sanitized name so it matches what GitHub stores and what
  # the manifest URL points to (avoids duplicate-name 422 on re-runs).
  $url = "$uploadBase`?name=$([uri]::EscapeDataString($sanitized))"
  try {
    Write-Host ("[{0}/{1}] {2,-50} {3:N1} MB" -f $i, $files.Count, $name, ($sz/1MB))
    $h = @{
      Authorization = "Bearer $Token"
      'User-Agent'  = 'BeyondDepthUploader'
      Accept        = 'application/vnd.github+json'
      'Content-Type'= 'application/octet-stream'
    }
    $bytes = [System.IO.File]::ReadAllBytes($f)
    $null = Invoke-RestMethod -Uri $url -Method Post -Headers $h -Body $bytes -TimeoutSec 600
    $uploaded++
  } catch {
    Write-Warning "FAIL $name : $($_.Exception.Message)"
    $failed++
  }
}
Write-Host "`nDone. uploaded=$uploaded skipped=$skipped failed=$failed"
