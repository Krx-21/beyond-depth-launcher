param([string]$Tag = 'v0.1.7')
$ErrorActionPreference = 'Stop'
$h = @{ Authorization = "Bearer $env:GH_TOKEN"; 'User-Agent' = 'x'; Accept = 'application/vnd.github+json' }
$rels = Invoke-RestMethod 'https://api.github.com/repos/Krx-21/beyond-depth-launcher/releases?per_page=5' -Headers $h
$rel = $rels | Where-Object { $_.tag_name -eq $Tag }
if (-not $rel) { throw "release $Tag not found" }
"id=$($rel.id) draft=$($rel.draft)"
$old = $rel.assets | Where-Object { $_.name -eq 'manifest.json' }
if ($old) {
    Invoke-RestMethod "https://api.github.com/repos/Krx-21/beyond-depth-launcher/releases/assets/$($old.id)" -Method Delete -Headers $h | Out-Null
    "deleted old manifest asset"
}
$url = ($rel.upload_url -replace '\{.*\}$','') + '?name=manifest.json'
$bytes = [System.IO.File]::ReadAllBytes('C:\Users\godof\Documents\Beyond Depth Launcher\dist\manifest.json')
$hh = @{ Authorization = "Bearer $env:GH_TOKEN"; 'User-Agent' = 'x'; Accept = 'application/vnd.github+json'; 'Content-Type' = 'application/json' }
$res = Invoke-RestMethod -Uri $url -Method Post -Headers $hh -Body $bytes
"uploaded $($res.name) size=$($res.size)"
$body = @{ draft = $false; name = $Tag; tag_name = $Tag } | ConvertTo-Json
$patched = Invoke-RestMethod "https://api.github.com/repos/Krx-21/beyond-depth-launcher/releases/$($rel.id)" -Method Patch -Headers $hh -Body $body
"draft=$($patched.draft)"
