Unicode true
Name "FOLAX Codex Setup Download v2"
OutFile "${OUTPUT_FILE}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
Page instfiles
Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=Download-Windows.cmd "${DOWNLOAD_LAUNCHER}"
  File /oname=Download-Windows.ps1 "${DOWNLOAD_SCRIPT}"
  File /oname=windows-download.json "${DOWNLOAD_MANIFEST}"
  DetailPrint "Downloading app + Chrome extension. Official GitHub fallback is enabled."
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /D /C ""$PLUGINSDIR\Download-Windows.cmd""'
  Pop $0
  StrCmp $0 "0" done
  SetErrorLevel 1
  MessageBox MB_OK|MB_ICONSTOP "Download failed on both official routes. Verified files were kept. Run this NEW downloader again to resume."
  Abort
done:
  DetailPrint "Ready: open the app in Downloads\BlogAuto-Windows."
SectionEnd
