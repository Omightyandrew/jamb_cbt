Add-Type -AssemblyName System.Drawing

$font = New-Object System.Drawing.Font("Arial", [float]30, [System.Drawing.FontStyle]::Bold)
$bmp = New-Object System.Drawing.Bitmap(400, 100)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
$g.DrawString("TEST STRING", $font, $brush, [float]20, [float]20)
$g.Dispose()
$bmp.Save((Resolve-Path "scratch\test_font.jpg"), [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bmp.Dispose()
Write-Output "FONT_TEST_DONE"
