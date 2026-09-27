; Tauri NSIS installer hooks (bundle.windows.nsis.installerHooks).

; The per-user installer and uninstaller run unelevated, so an install under Program Files is
; read-only to them. One elevated icacls grants the signed-in user Modify on the folder, and the
; setup carries on as that user, keeping its registry writes in that user's HKCU. The grant
; covers only a folder holding the app or a folder the setup creates.
!macro GrantInstallDirToUser
  ClearErrors
  FileOpen $0 "$INSTDIR\.ltk-write-test" w
  ${If} ${Errors}
    ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    ${OrIfNot} ${FileExists} "$INSTDIR\*.*"
      nsExec::ExecToStack 'whoami /user /fo csv /nh'
      Pop $1
      Pop $2
      ; The output is "machine\user","S-1-5-...".
      ${WordFind} $2 '","' "+2" $2
      ${WordFind} $2 '"' "+1" $2

      ClearErrors
      ExecShellWait "runas" "cmd.exe" '/c md "$INSTDIR" 2>nul & icacls "$INSTDIR" /grant *$2:(OI)(CI)M' SW_HIDE
    ${EndIf}

    ClearErrors
    FileOpen $0 "$INSTDIR\.ltk-write-test" w
    ${If} ${Errors}
      Abort "$INSTDIR is read-only. Run the setup as administrator."
    ${EndIf}
  ${EndIf}

  FileClose $0
  Delete "$INSTDIR\.ltk-write-test"
!macroend

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /T /IM ltk_patcher_host.exe'
  Pop $0

  !insertmacro GrantInstallDirToUser
  SetOutPath $INSTDIR
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /T /IM ltk_patcher_host.exe'
  Pop $0

  !insertmacro GrantInstallDirToUser
!macroend
