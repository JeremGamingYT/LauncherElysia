!macro customInit
  ; Code personnalisé exécuté avant l'installation
  ; Vérification de la présence d'une ancienne version
  IfFileExists "$APPDATA\.elysia\*.*" 0 +2
    MessageBox MB_YESNO "Une installation précédente a été détectée. Voulez-vous conserver vos données existantes?" IDYES KeepData IDNO DeleteData
  DeleteData:
    RMDir /r "$APPDATA\.elysia"
    Goto EndInit
  KeepData:
    ; Garder les données mais supprimer les fichiers de configuration potentiellement problématiques
    Delete "$APPDATA\.elysia\config.json"
    Delete "$APPDATA\.elysia\launcher_config.json"
  EndInit:
!macroend

!macro customInstall
  ; Création des raccourcis et association des fichiers
  WriteRegStr HKCR ".elysia" "" "ElysiaLauncher"
  WriteRegStr HKCR "ElysiaLauncher" "" "Elysia Launcher"
  WriteRegStr HKCR "ElysiaLauncher\DefaultIcon" "" "$INSTDIR\Elysia.exe,0"
  WriteRegStr HKCR "ElysiaLauncher\shell\open\command" "" '"$INSTDIR\Elysia.exe" "%1"'
  
  ; Créer des dossiers essentiels
  CreateDirectory "$APPDATA\.elysia\instances"
  CreateDirectory "$APPDATA\.elysia\assets"
  CreateDirectory "$APPDATA\.elysia\versions"
  CreateDirectory "$APPDATA\.elysia\libraries"
  
  ; Copier les fichiers de données essentiels
  CopyFiles "$INSTDIR\Resources\resources.json" "$APPDATA\.elysia\resources.json"
  CopyFiles "$INSTDIR\Resources\servers.dat" "$APPDATA\.elysia\servers.dat"
!macroend

!macro customUnInstall
  ; Suppression complète des dossiers de l'application
  MessageBox MB_YESNO "Voulez-vous supprimer complètement toutes les données du launcher (profils, paramètres, etc.)?" IDYES DeleteAll IDNO KeepUserData
  
  DeleteAll:
    RMDir /r "$APPDATA\.elysia"
  
  KeepUserData:
    ; Toujours supprimer les fichiers temporaires
    RMDir /r "$LOCALAPPDATA\${APP_FILENAME}"
    RMDir /r "$TEMP\fabric-installer-1.0.1.jar"
    RMDir /r "$TEMP\jdk-21-installer.exe"
    RMDir /r "$TEMP\index.html"
    RMDir /r "$TEMP\splash.html"
    
    ; Supprimer les associations de fichiers
    DeleteRegKey HKCR ".elysia"
    DeleteRegKey HKCR "ElysiaLauncher"
!macroend 