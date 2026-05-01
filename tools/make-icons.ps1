param(
  [string]$AssetDir = 'C:\Users\godof\Documents\Beyond Depth Launcher\assets'
)

New-Item -ItemType Directory -Force -Path $AssetDir | Out-Null
Add-Type -AssemblyName System.Drawing

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

$rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(255, 30, 30, 46),
  [System.Drawing.Color]::FromArgb(255, 49, 50, 68),
  135.0)
$g.FillRectangle($brush, $rect)

$accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(80, 137, 180, 250))
$g.FillEllipse($accent, 60, 40, 200, 200)

$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 137, 180, 250), 14)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($pen, 60, 200, 200, 60)

$font = New-Object System.Drawing.Font('Segoe UI', 96, [System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString('BD', $font, $textBrush, [System.Drawing.RectangleF]::new(0, 0, $size, $size), $sf)
$g.Dispose()

$pngPath = Join-Path $AssetDir 'icon.png'
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Wrote $pngPath"

$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$icoPath = Join-Path $AssetDir 'icon.ico'
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]1)
$bw.Write([byte]0)
$bw.Write([byte]0)
$bw.Write([byte]0)
$bw.Write([byte]0)
$bw.Write([uint16]1)
$bw.Write([uint16]32)
$bw.Write([uint32]$pngBytes.Length)
$bw.Write([uint32]22)
$bw.Write($pngBytes)
$bw.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
Write-Host "Wrote $icoPath"

$bmp.Dispose()
