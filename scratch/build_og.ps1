Add-Type -AssemblyName System.Drawing

$baseDir = "c:\Users\igbawua andrew\Downloads\exampilot"
$outFile = Join-Path $baseDir "assets\logo\og-student.jpg"
$studentPath = Join-Path $baseDir "media\student-practicing.jpg"

$width = 1200
$height = 630

$bmp = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# 1. Background Gradient
$rect = New-Object System.Drawing.Rectangle(0, 0, $width, $height)
$c1 = [System.Drawing.Color]::FromArgb(20, 33, 61)   # #14213D navy
$c2 = [System.Drawing.Color]::FromArgb(10, 42, 28)   # deep emerald
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, [float]135.0)
$g.FillRectangle($brush, $rect)
$brush.Dispose()

# 2. Outer decorative border
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(45, 0, 135, 81), [float]2)
$g.DrawRectangle($pen, 35, 35, 1130, 560)
$pen.Dispose()

# 3. Student Photo
if (Test-Path $studentPath) {
    $img = [System.Drawing.Image]::FromFile($studentPath)
    $pX = 600
    $pY = 75
    $pW = 530
    $pH = [int]([Math]::Round($pW * ($img.Height / [double]$img.Width))) # 260px

    # Drop shadow
    $shBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 0, 0, 0))
    $g.FillRectangle($shBrush, ($pX + 8), ($pY + 8), $pW, $pH)
    $shBrush.Dispose()

    # Draw photo (exact natural aspect ratio)
    $sRect = New-Object System.Drawing.Rectangle(0, 0, $img.Width, $img.Height)
    $dRect = New-Object System.Drawing.Rectangle($pX, $pY, $pW, $pH)
    $g.DrawImage($img, $dRect, $sRect, [System.Drawing.GraphicsUnit]::Pixel)

    # Accent border
    $bPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 0, 135, 81), [float]3)
    $g.DrawRectangle($bPen, $pX, $pY, $pW, $pH)
    $bPen.Dispose()

    # Tag badge
    $tagBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 20, 33, 61))
    $g.FillRectangle($tagBrush, ($pX + 16), ($pY + $pH - 38), 260, 28)
    $tagBrush.Dispose()

    $tagFont = New-Object System.Drawing.Font("Segoe UI", [float]9.5, [System.Drawing.FontStyle]::Bold)
    $tagTBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 215, 130))
    $g.DrawString("AUTHENTIC CBT PRACTICE SESSION", $tagFont, $tagTBrush, [float]($pX + 26), [float]($pY + $pH - 33))
    $tagFont.Dispose()
    $tagTBrush.Dispose()

    $img.Dispose()

    # Bottom feature panel
    $cY = $pY + $pH + 20
    $cH = 175
    $cBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 255, 255, 255))
    $g.FillRectangle($cBrush, $pX, $cY, $pW, $cH)
    $cBrush.Dispose()

    $cPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 0, 135, 81), [float]1.5)
    $g.DrawRectangle($cPen, $pX, $cY, $pW, $cH)
    $cPen.Dispose()

    $fFont = New-Object System.Drawing.Font("Segoe UI", [float]12, [System.Drawing.FontStyle]::Bold)
    $fBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.DrawString("Why Students Choose ExamPilot", $fFont, $fBrush, [float]($pX + 20), [float]($cY + 16))
    $fFont.Dispose()
    $fBrush.Dispose()

    $bFont = New-Object System.Drawing.Font("Segoe UI", [float]10.5, [System.Drawing.FontStyle]::Regular)
    $bBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 235, 225))
    $chkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 215, 130))

    $g.DrawString("✓", $bFont, $chkBrush, [float]($pX + 20), [float]($cY + 52))
    $g.DrawString("180-Question authentic CBT mock examinations", $bFont, $bBrush, [float]($pX + 42), [float]($cY + 52))

    $g.DrawString("✓", $bFont, $chkBrush, [float]($pX + 20), [float]($cY + 84))
    $g.DrawString("24/7 AI Study Tutor for step-by-step guidance", $bFont, $bBrush, [float]($pX + 42), [float]($cY + 84))

    $g.DrawString("✓", $bFont, $chkBrush, [float]($pX + 20), [float]($cY + 116))
    $g.DrawString("Full coverage: JAMB, WAEC, NECO & NABTEB", $bFont, $bBrush, [float]($pX + 42), [float]($cY + 116))

    $bFont.Dispose()
    $bBrush.Dispose()
    $chkBrush.Dispose()
}

# 4. Left Content
$lX = 70

# Brand Pill
$brandBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 135, 81))
$g.FillRectangle($brandBg, $lX, 75, 155, 34)
$brandBg.Dispose()

$brandF = New-Object System.Drawing.Font("Segoe UI", [float]11.5, [System.Drawing.FontStyle]::Bold)
$wBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.DrawString("EXAMPILOT", $brandF, $wBrush, [float]($lX + 16), [float]82)
$brandF.Dispose()

$eyeF = New-Object System.Drawing.Font("Segoe UI", [float]10.5, [System.Drawing.FontStyle]::Bold)
$mintB = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(160, 230, 190))
$g.DrawString("NIGERIA'S PREMIER CBT PLATFORM", $eyeF, $mintB, [float]($lX + 172), [float]84)
$eyeF.Dispose()
$mintB.Dispose()

$hFont = New-Object System.Drawing.Font("Segoe UI", [float]26, [System.Drawing.FontStyle]::Bold)
$hRect = New-Object System.Drawing.RectangleF([float]$lX, [float]132, [float]490, [float]140)
$g.DrawString("Prepare with purpose.`nMaster your exams with confidence.", $hFont, $wBrush, $hRect)
$hFont.Dispose()

$sFont = New-Object System.Drawing.Font("Segoe UI", [float]13, [System.Drawing.FontStyle]::Regular)
$sBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 220, 235))
$sRect = New-Object System.Drawing.RectangleF([float]$lX, [float]285, [float]485, [float]95)
$g.DrawString("Comprehensive online preparation for Nigerian students: verified past questions, AI tutoring, syllabus guides, and full-length timed CBT practice.", $sFont, $sBrush, $sRect)
$sFont.Dispose()
$sBrush.Dispose()

# Badges
$bgF = New-Object System.Drawing.Font("Segoe UI", [float]10, [System.Drawing.FontStyle]::Bold)
$pillB = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(35, 55, 95))
$pillTxtB = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(100, 240, 170))

$curX = $lX
foreach ($name in @("JAMB (UTME)", "WAEC (WASSCE)", "NECO (SSCE)", "NABTEB")) {
    $w = [int]($name.Length * 8.5) + 20
    $g.FillRectangle($pillB, $curX, 395, $w, 32)
    $g.DrawString($name, $bgF, $pillTxtB, [float]($curX + 10), [float]402)
    $curX += $w + 8
}
$bgF.Dispose()
$pillB.Dispose()
$pillTxtB.Dispose()

$uFont = New-Object System.Drawing.Font("Segoe UI", [float]13, [System.Drawing.FontStyle]::Bold)
$goldB = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 215, 0))
$g.DrawString("https://exampilot.com.ng/", $uFont, $goldB, [float]$lX, [float]465)
$uFont.Dispose()
$goldB.Dispose()

$subF = New-Object System.Drawing.Font("Segoe UI", [float]10.5, [System.Drawing.FontStyle]::Regular)
$dimB = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(160, 180, 205))
$g.DrawString("Start free CBT practice online · No app download required", $subF, $dimB, [float]$lX, [float]495)
$subF.Dispose()
$dimB.Dispose()

$wBrush.Dispose()
$g.Dispose()

$bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bmp.Dispose()

Write-Output "SUCCESS_IMAGE_CREATED"
