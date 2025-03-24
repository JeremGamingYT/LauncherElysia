!macro customUnInstall
  ; Suppression complète des dossiers de l'application
  RMDir /r "$APPDATA\.elysia"
  RMDir /r "$LOCALAPPDATA\${APP_FILENAME}"
  RMDir /r "$TEMP\fabric-installer-1.0.1.jar"
  RMDir /r "$TEMP\jdk-21-installer.exe"
  RMDir /r "$TEMP\index.html"
  RMDir /r "$TEMP\splash.html"
!macroend 