!macro customInstall
  ${if} ${FileExists} "$INSTDIR\resources\assets\icon.ico"
    !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
      ${if} ${FileExists} "$newStartMenuLink"
        Delete "$newStartMenuLink"
        CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\assets\icon.ico" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
      ${endif}
    !endif

    !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
      ${ifNot} ${isNoDesktopShortcut}
      ${andIf} ${FileExists} "$newDesktopLink"
        Delete "$newDesktopLink"
        CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\assets\icon.ico" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      ${endif}
    !endif
  ${endif}
!macroend
