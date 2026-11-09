@echo off
setlocal
set "FOLAX_DOWNLOAD_SCRIPT=%~dp0Download-Windows.ps1"
set "FOLAX_DOWNLOAD_MANIFEST=%~dp0windows-download.json"
powershell.exe -NoLogo -NoProfile -Command "& ([scriptblock]::Create([IO.File]::ReadAllText($env:FOLAX_DOWNLOAD_SCRIPT))) -ManifestPath $env:FOLAX_DOWNLOAD_MANIFEST"
if errorlevel 1 (
 echo Download failed. Verified files were kept. Run this NEW downloader again to resume.
 exit /b 1
)
exit /b 0
