@echo off
setlocal
set "FOLAX_PATCH_SCRIPT=%~dp0apply.ps1"
set "FOLAX_PATCH_MANIFEST=%~dp0patch.json"
powershell.exe -NoLogo -NoProfile -STA -Command "& ([scriptblock]::Create([IO.File]::ReadAllText($env:FOLAX_PATCH_SCRIPT))) -ManifestPath $env:FOLAX_PATCH_MANIFEST"
exit /b %errorlevel%
