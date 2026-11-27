Add-Type -AssemblyName System.Drawing

$testBmp = New-Object System.Drawing.Bitmap 1200, 630
$g = [System.Drawing.Graphics]::FromImage($testBmp)
$g.Clear([System.Drawing.Color]::FromArgb(20, 33, 61)) # #14213D brand navy
$g.Dispose()
$testBmp.Dispose()
Write-Output "SYSTEM_DRAWING_SUCCESS"
