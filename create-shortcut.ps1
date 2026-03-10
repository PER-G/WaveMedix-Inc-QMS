# Create Wavemedix QMS Desktop Shortcut with custom icon
# Run this once: Right-click > "Run with PowerShell"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Wavemedix QMS.lnk"
$batPath = Join-Path $projectDir "start-qms.bat"
$iconPath = Join-Path $projectDir "wavemedix.ico"

# Create a simple .ico file (green shield on dark background) using .NET
Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# Background - dark teal rounded rect
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(256, 256)),
    [System.Drawing.Color]::FromArgb(255, 15, 43, 60),
    [System.Drawing.Color]::FromArgb(255, 26, 74, 94)
)
$g.FillRectangle($bgBrush, 0, 0, 256, 256)

# Shield outline
$shieldPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 16, 185, 129), 8)
$shieldPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$shieldPoints = @(
    (New-Object System.Drawing.Point(128, 40)),
    (New-Object System.Drawing.Point(68, 68)),
    (New-Object System.Drawing.Point(68, 128)),
    (New-Object System.Drawing.Point(128, 190)),
    (New-Object System.Drawing.Point(188, 128)),
    (New-Object System.Drawing.Point(188, 68))
)
$shieldPath.AddPolygon($shieldPoints)
$shieldPath.CloseFigure()
$g.DrawPath($shieldPen, $shieldPath)

# Checkmark inside
$checkPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 134, 239, 172), 12)
$checkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$checkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($checkPen, 100, 125, 120, 150)
$g.DrawLine($checkPen, 120, 150, 160, 100)

# "QMS" text at bottom
$font = New-Object System.Drawing.Font("Arial", 24, [System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 134, 239, 172))
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$g.DrawString("QMS", $font, $textBrush, 128, 200, $sf)

$g.Dispose()

# Save as .ico
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $ms.ToArray()
$ms.Dispose()
$bmp.Dispose()

# Build ICO file format
$icoStream = New-Object System.IO.FileStream($iconPath, [System.IO.FileMode]::Create)
$writer = New-Object System.IO.BinaryWriter($icoStream)

# ICO header
$writer.Write([UInt16]0)      # Reserved
$writer.Write([UInt16]1)      # Type: ICO
$writer.Write([UInt16]1)      # Image count

# Image entry (256x256)
$writer.Write([byte]0)        # Width (0 = 256)
$writer.Write([byte]0)        # Height (0 = 256)
$writer.Write([byte]0)        # Color palette
$writer.Write([byte]0)        # Reserved
$writer.Write([UInt16]1)      # Color planes
$writer.Write([UInt16]32)     # Bits per pixel
$writer.Write([UInt32]$pngBytes.Length)  # Image size
$writer.Write([UInt32]22)     # Image offset

# Image data (PNG)
$writer.Write($pngBytes)
$writer.Close()
$icoStream.Close()

Write-Host "Icon erstellt: $iconPath" -ForegroundColor Green

# Create Windows shortcut
$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $batPath
$shortcut.WorkingDirectory = $projectDir
$shortcut.IconLocation = $iconPath
$shortcut.Description = "Wavemedix Quality Management System starten"
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Host ""
Write-Host "Desktop-Verknuepfung erstellt: $shortcutPath" -ForegroundColor Green
Write-Host ""
Write-Host "Du kannst jetzt 'Wavemedix QMS' auf dem Desktop doppelklicken!" -ForegroundColor Cyan
Write-Host ""
Read-Host "Druecke Enter zum Schliessen"
