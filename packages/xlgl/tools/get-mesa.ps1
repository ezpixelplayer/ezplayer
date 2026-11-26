# Fetches the Mesa llvmpipe software GL driver for the xlgl software path on
# Windows into bin\win32-x64\mesa (git-ignored: libgallium_wgl.dll is ~60 MB).
# Needs 7-Zip (7z.exe) because the mesa-dist-win release is a .7z archive.
# Usage: powershell -ExecutionPolicy Bypass -File get-mesa.ps1 [-Version 26.2.4]
param([string]$Version = "26.2.4")
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here "..\..\bin\win32-x64\mesa"
$tmp = Join-Path $env:TEMP "mesa-dist-win-$Version"
New-Item -ItemType Directory -Force $out | Out-Null
New-Item -ItemType Directory -Force $tmp | Out-Null
$archive = Join-Path $tmp "mesa.7z"
$url = "https://github.com/pal1000/mesa-dist-win/releases/download/$Version/mesa3d-$Version-release-msvc.7z"
if (-not (Test-Path $archive)) {
    Write-Host "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $archive
}
$sevenZip = Get-Command 7z.exe -ErrorAction SilentlyContinue
if ($null -eq $sevenZip) { $sevenZip = "C:\Program Files\7-Zip\7z.exe" } else { $sevenZip = $sevenZip.Source }
if (-not (Test-Path $sevenZip)) { throw "7-Zip not found; install it or extract $archive by hand" }
& $sevenZip x -y $archive "-o$tmp\extract" "x64\opengl32.dll" "x64\libgallium_wgl.dll" "readme.txt" | Out-Null
Copy-Item (Join-Path $tmp "extract\x64\opengl32.dll") $out -Force
Copy-Item (Join-Path $tmp "extract\x64\libgallium_wgl.dll") $out -Force
Copy-Item (Join-Path $tmp "extract\readme.txt") (Join-Path $out "mesa-dist-win-readme.txt") -Force
"Mesa $Version from $url (MIT licence, see mesa-dist-win-readme.txt)" | Set-Content (Join-Path $out "VERSION.txt")
Write-Host "Mesa $Version installed to $out"
