Unicode true
Name "FOLAX rc.24 Revision Fix"
OutFile "${OUTPUT_FILE}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
Page instfiles
Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=apply.cmd "${PATCH_LAUNCHER}"
  File /oname=apply.ps1 "${PATCH_SCRIPT}"
  File /oname=patch.json "${PATCH_MANIFEST}"
  File /oname=literal.bin "${PATCH_DATA}"
  DetailPrint "Select your original rc.24 EXE. The original and all account data are preserved."
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /D /C ""$PLUGINSDIR\apply.cmd""'
  Pop $0
  StrCmp $0 "2" cancelled
  StrCmp $0 "0" done
  SetErrorLevel 1
  MessageBox MB_OK|MB_ICONSTOP "Patch could not be applied. Original EXE and account data are unchanged."
  Abort
cancelled:
  DetailPrint "Cancelled. Original file unchanged."
  Goto end
done:
  DetailPrint "Ready. Close the old app and run the new rc.24.1 EXE."
end:
SectionEnd
