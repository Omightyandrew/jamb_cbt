Add-Type -AssemblyName System.Drawing

$width = 1200
$height = 630

$bmp = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# 1. Background Gradient: Deep Navy (#14213D) to Deep Emerald Green (#0a2f20)
$rect = New-Object System.Drawing.Rectangle(0, 0, $width, $height)
$color1 = [System.Drawing.Color]::FromArgb(20, 33, 61)   # #14213D
$color2 = [System.Drawing.Color]::FromArgb(10, 42, 28)   # Deep brand green
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $color1, $color2, [float]135.0)
$g.FillRectangle($brush, $rect)
$brush.Dispose()

# 2. Outer decorative border
$accentPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(45, 0, 135, 81), [float]2)
$g.DrawRectangle($accentPen, 35, 35, 1130, 560)
$accentPen.Dispose()

# 3. Student Photo Placement (Right side, strictly preserving natural aspect ratio)
# student-practicing.jpg is 686 x 336 (aspect ratio 2.0416:1)
$studentPath = Join-Path $PSScriptRoot "..\media\student-practicing.jpg"
if (Test-Path $studentPath) {
    $img = [System.Drawing.Image]::FromFile($studentPath)
    
    $photoX = 600
    $photoY = 75
    $photoW = 530
    $photoH = [int]([Math]::Round($photoW * ($img.Height / [double]$img.Width))) # exactly 260px!

    # Drop shadow
    $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 0, 0, 0))
    $g.FillRectangle($shadowBrush, ($photoX + 8), ($photoY + 8), $photoW, $photoH)
    $shadowBrush.Dispose()

    # Draw photo with exact aspect ratio
    $srcRect = New-Object System.Drawing.Rectangle(0, 0, $img.Width, $img.Height)
    $dstRect = New-Object System.Drawing.Rectangle($photoX, $photoY, $photoW, $photoH)
    $g.DrawImage($img, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

    # Accent border around photograph
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 0, 135, 81), [float]3)
    $g.DrawRectangle($borderPen, $photoX, $photoY, $photoW, $photoH)
    $borderPen.Dispose()

    # Photo overlay tag: "AUTHENTIC CBT PRACTICE"
    $tagBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 20, 33, 61))
    $g.FillRectangle($tagBrush, ($photoX + 16), ($photoY + $photoH - 38), 260, 28)
    $tagBrush.Dispose()

    $tagFont = [System.Drawing.Font]::new("Segoe UI", [float]9.5, [System.Drawing.FontStyle]::Bold)
    $tagTextBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 215, 130))
    $g.DrawString("AUTHENTIC CBT PRACTICE SESSION", $tagFont, $tagTextBrush, [float]($photoX + 26), [float]($photoY + $photoH - 33))
    $tagFont.Dispose()
    $tagTextBrush.Dispose()

    $img.Dispose()

    # Feature Panel below student photo
    $cardY = $photoY + $photoH + 20
    $cardH = 175
    $cardBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 255, 255, 255))
    $g.FillRectangle($cardBrush, $photoX, $cardY, $photoW, $cardH)
    $cardBrush.Dispose()

    $cardBorderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 0, 135, 81), [float]1.5)
    $g.DrawRectangle($cardBorderPen, $photoX, $cardY, $photoW, $cardH)
    $cardBorderPen.Dispose()

    # Key highlights in panel
    $featFont = [System.Drawing.Font]::new("Segoe UI", [float]12, [System.Drawing.FontStyle]::Bold)
    $featBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.DrawString("Why Students Choose ExamPilot", $featFont, $featBrush, [float]($photoX + 20), [float]($cardY + 16))
    $featFont.Dispose()
    $featBrush.Dispose()

    $bulletFont = [System.Drawing.Font]::new("Segoe UI", [float]10.5, [System.Drawing.FontStyle]::Regular)
    $bulletBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 235, 225))
    $checkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 215, 130))

    $g.DrawString("✓", $bulletFont, $checkBrush, [float]($photoX + 20), [float]($cardY + 52))
    $g.DrawString("180-Question authentic CBT mock examinations", $bulletFont, $bulletBrush, [float]($photoX + 42), [float]($cardY + 52))

    $g.DrawString("✓", $bulletFont, $checkBrush, [float]($photoX + 20), [float]($cardY + 84))
    $g.DrawString("24/7 AI Study Tutor for step-by-step guidance", $bulletFont, $bulletBrush, [float]($photoX + 42), [float]($cardY + 84))

    $g.DrawString("✓", $bulletFont, $checkBrush, [float]($photoX + 20), [float]($cardY + 116))
    $g.DrawString("Full coverage: JAMB, WAEC, NECO & NABTEB", $bulletFont, $bulletBrush, [float]($photoX + 42), [float]($cardY + 116))

    $bulletFont.Dispose()
    $bulletBrush.Dispose()
    $checkBrush.Dispose()
}

# 4. Left Content Area (Branding, Value Proposition, CTAs)
$leftX = 70

# Brand Pill: "EXAMPILOT"
$brandBgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 135, 81)) # Brand green
$g.FillRectangle($brandBgBrush, $leftX, 75, 155, 34)
$brandBgBrush.Dispose()

$brandFont = [System.Drawing.Font]::new("Segoe UI", [float]11.5, [System.Drawing.FontStyle]::Bold)
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.DrawString("EXAMPILOT", $brandFont, $whiteBrush, [float]($leftX + 16), [float]82)
$brandFont.Dispose()

# Eyebrow Tag
$eyeFont = [System.Drawing.Font]::new("Segoe UI", [float]10.5, [System.Drawing.FontStyle]::Bold)
$mintBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(160, 230, 190))
$g.DrawString("NIGERIA'S PREMIER CBT PLATFORM", $eyeFont, $mintBrush, [float]($leftX + 172), [float]84)
$eyeFont.Dispose()
$mintBrush.Dispose()

# Main Headline
$headFont = [System.Drawing.Font]::new("Segoe UI", [float]26, [System.Drawing.FontStyle]::Bold)
$headBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$headRect = New-Object System.Drawing.RectangleF([float]$leftX, [float]132, [float]490, [float]140)
$g.DrawString("Prepare with purpose.`nMaster your exams with confidence.", $headFont, $headBrush, $headRect)
$headFont.Dispose()
$headBrush.Dispose()

# Summary Text
$subFont = [System.Drawing.Font]::new("Segoe UI", [float]13, [System.Drawing.FontStyle]::Regular)
$subBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 220, 235))
$subRect = New-Object System.Drawing.RectangleF([float]$leftX, [float]285, [float]485, [float]95)
$g.DrawString("Comprehensive online preparation for Nigerian students: verified past questions, AI tutoring, syllabus guides, and full-length timed CBT practice.", $subFont, $subBrush, $subRect)
$subFont.Dispose()
$subBrush.Dispose()

# Exam Badges: [ JAMB ] [ WAEC ] [ NECO ] [ NABTEB ]
$badgeFont = [System.Drawing.Font]::new("Segoe UI", [float]10, [System.Drawing.FontStyle]::Bold)
$badgePillBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(35, 55, 95))
$badgeTextBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(100, 240, 170))

$examNames = @("JAMB (UTME)", "WAEC (WASSCE)", "NECO (SSCE)", "NABTEB")
$bX = $leftX
foreach ($name in $examNames) {
    $textWidth = [int]($name.Length * 8.5) + 20
    $g.FillRectangle($badgePillBrush, $bX, 395, $textWidth, 32)
    $g.DrawString($name, $badgeFont, $badgeTextBrush, [float]($bX + 10), [float]402)
    $bX += $textWidth + 8
}
$badgeFont.Dispose()
$badgePillBrush.Dispose()
$badgeTextBrush.Dispose()

# Domain / CTA at bottom left
$urlFont = [System.Drawing.Font]::new("Segoe UI", [float]13, [System.Drawing.FontStyle]::Bold)
$goldBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 215, 0)) # Brand Gold
$g.DrawString("https://exampilot.com.ng/", $urlFont, $goldBrush, [float]$leftX, [float]465)
$urlFont.Dispose()
$goldBrush.Dispose()

$subCallFont = [System.Drawing.Font]::new("Segoe UI", [float]10.5, [System.Drawing.FontStyle]::Regular)
$dimBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(160, 180, 205))
$g.DrawString("Start free CBT practice online · No app download required", $subCallFont, $dimBrush, [float]$leftX, [float]495)
$subCallFont.Dispose()
$dimBrush.Dispose()

# Clean up
$whiteBrush.Dispose()
$g.Dispose()

# Save as optimized JPEG
$outDir = Join-Path $PSScriptRoot "..\assets\logo"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$outFile = Join-Path $outDir "og-student.jpg"

$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]90)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }

$bmp.Save($outFile, $codec, $encoderParams)
$bmp.Dispose()

$fileInfo = Get-Item $outFile
Write-Output "GENERATED: $($fileInfo.FullName) | Size: $($fileInfo.Length) bytes"
