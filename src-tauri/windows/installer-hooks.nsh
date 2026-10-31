; Tauri NSIS installer hooks (bundle.windows.nsis.installerHooks).
;
; The install directory is pinned to Program Files per
; docs/adr/0055-ltk-manager-installs-per-machine.md.

Var LtkInstDirProtected

; Whether $INSTDIR sits under a Program Files root, which only an
; administrator can write.
Function LtkCheckInstDir
  Push $0
  Push $1

  StrCpy $LtkInstDirProtected 0

  StrLen $0 "$PROGRAMFILES64\"
  StrCpy $1 "$INSTDIR" $0
  ${If} $1 == "$PROGRAMFILES64\"
    StrCpy $LtkInstDirProtected 1
  ${EndIf}

  StrLen $0 "$PROGRAMFILES32\"
  StrCpy $1 "$INSTDIR" $0
  ${If} $1 == "$PROGRAMFILES32\"
    StrCpy $LtkInstDirProtected 1
  ${EndIf}

  Pop $1
  Pop $0
FunctionEnd

; Greys out the install button while the chosen directory is unprotected.
Function .onVerifyInstDir
  Call LtkCheckInstDir

  ${If} $LtkInstDirProtected == 0
    Abort
  ${EndIf}
FunctionEnd

; Uninstall a per-user install left by a currentUser bundle. `SHCTX` is `HKLM`
; here, so the template's own reinstall page never sees one, and what it leaves
; behind is a writable copy of the binaries the patcher elevates.
!macro LtkRemovePerUserInstall
  ReadRegStr $2 HKCU "${MANUPRODUCTKEY}" ""
  ReadRegStr $3 HKCU "${UNINSTKEY}" "UninstallString"

  ${If} $2 != ""
  ${AndIf} $3 != ""
  ${AndIf} $2 != "$INSTDIR"
  ${AndIf} ${FileExists} "$2\uninstall.exe"
    DetailPrint "Removing the per-user install at $2"

    ; `_?=` keeps the uninstaller in place rather than running a copy from
    ; %TEMP%, which is what makes ExecWait wait for it.
    ExecWait '$3 /S _?=$2'

    Delete "$2\uninstall.exe"
    RMDir "$2"

    ; The old uninstaller removed the shortcuts, and the template skips
    ; creating them under /UPDATE, which the updater always passes.
    StrCpy $UpdateMode 0
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; The directory page does not run under /S, so /D= is checked here too.
  Call LtkCheckInstDir

  ${If} $LtkInstDirProtected == 0
    MessageBox MB_ICONSTOP "LTK Manager installs under Program Files. $INSTDIR is writable without administrator rights, which the patcher does not allow."
    Abort
  ${EndIf}

  nsExec::Exec 'taskkill /F /T /IM ltk_patcher_host.exe'
  Pop $0

  ; A release that bundled the DLL left this copy, and no later uninstaller removes it.
  Delete "$INSTDIR\ltk_patcher_dll.dll"

  !insertmacro LtkRemovePerUserInstall
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /T /IM ltk_patcher_host.exe'
  Pop $0
!macroend

; Removes the mod file types the app registers for the user, per
; docs/adr/0060-mod-file-types-are-registered-per-user-by-the-app.md. This
; reaches the elevated token's hive alone, the limit ADR-0055 describes.
; Values go one by one, because another program may share these keys.
!macro LtkRemoveFileType EXT PROGID
  DeleteRegKey HKCU "Software\Classes\${PROGID}"
  DeleteRegValue HKCU "Software\Classes\${EXT}\OpenWithProgids" "${PROGID}"

  ReadRegStr $0 HKCU "Software\Classes\${EXT}" ""
  ${If} $0 == "${PROGID}"
    DeleteRegValue HKCU "Software\Classes\${EXT}" ""
  ${EndIf}

  DeleteRegValue HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" "${EXT}"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; An update uninstalls the old version too, and the new one owns the same keys.
  ${If} $UpdateMode <> 1
    !insertmacro LtkRemoveFileType ".fantome" "LTKManager.Fantome"
    !insertmacro LtkRemoveFileType ".modpkg" "LTKManager.Modpkg"

    DeleteRegValue HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName"
    DeleteRegKey HKCU "Software\LeagueToolkit\Manager\Capabilities"
    DeleteRegValue HKCU "Software\RegisteredApplications" "LTK Manager"

    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${EndIf}
!macroend
