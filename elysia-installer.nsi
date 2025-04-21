; Script NSIS pour le Launcher Elysia
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!include "nsDialogs.nsh"

; Interface websiteui personnalisée
!define WEBUI_PAGE "installer-page.html"
!define WEBUI_CSS_FILE "installer.css"

; Ajouter les plugins nsDialogs améliorés
!addincludedir "."
!include "NsisWebUI.nsh"

; Définitions
!define APP_NAME "Elysia Launcher"
!define COMP_NAME "Elysia"
!define WEB_SITE "https://elysia.fr"
!define VERSION "1.8.2"
!define COPYRIGHT "© 2023-2026 ${COMP_NAME}"
!define DESCRIPTION "Launcher Minecraft Elysia"
!define LICENSE_TXT "LICENSE"
!define INSTALLER_NAME "elysia-setup.exe"
!define MAIN_APP_EXE "Elysia.exe"
!define INSTALL_TYPE "SetShellVarContext current"
!define REG_ROOT "HKCU"
!define REG_APP_PATH "Software\Microsoft\Windows\CurrentVersion\App Paths\${MAIN_APP_EXE}"
!define UNINSTALL_PATH "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
!define REG_START_MENU "Start Menu Folder"

var SM_Folder
var CreateDesktopShortcut
var CreateStartMenuShortcut
var InstallationProgress
var InstallationInfo

; Réglages modernes
SetCompressor /SOLID lzma
Name "${APP_NAME}"
OutFile "dist\${INSTALLER_NAME}"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey "${REG_ROOT}" "${REG_APP_PATH}" ""
ShowInstDetails show
ShowUnInstDetails show

; Interface utilisateur moderne
!define MUI_ICON "src\assets\icon.ico"
!define MUI_UNICON "src\assets\icon.ico"
!define MUI_ABORTWARNING

; Initialiser WebUI
!insertmacro WebUIInit

; Personnalisation de la page d'interface utilisateur web
!define WEBUI_SCRIPT_ON_LOAD "if (document.getElementById('install-dir')) document.getElementById('install-dir').value = '$INSTDIR';"
!define WEBUI_BROWSER_COMMAND ""

; Inclure les macros personnalisées
!include "installer.nsh"

Function .onInit
  !insertmacro customInit
  
  ; Vérifier la version de Windows
  ${IfNot} ${AtLeastWin8.1}
    MessageBox MB_OK|MB_ICONSTOP "Ce launcher nécessite Windows 8.1 ou une version plus récente."
    Abort
  ${EndIf}
  
  ; Vérifier si une instance est en cours d'exécution
  FindProcDLL::FindProc "${MAIN_APP_EXE}"
  ${If} $R0 == "1"
    MessageBox MB_OK|MB_ICONEXCLAMATION "Le launcher Elysia est actuellement en cours d'exécution. Veuillez le fermer avant de continuer l'installation."
    Abort
  ${EndIf}
FunctionEnd

; Fonction de mise à jour du chemin d'installation
Function BrowseDestination
  nsDialogs::SelectFolderDialog "Sélectionnez le dossier d'installation:" $INSTDIR
  Pop $0
  ${If} $0 != "error"
    StrCpy $INSTDIR $0
    ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('install-dir').value = '$INSTDIR';"
  ${EndIf}
FunctionEnd

; Fonction pour commencer l'installation
Function StartInstallation
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('install-button').disabled = true;"
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('cancel-button').disabled = true;"
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('installation-info').innerHTML = 'Installation en cours...';"
  
  ; Récupérer les valeurs depuis l'interface
  ${NSD_WebView_GetValue} $WebUIBrowser "document.getElementById('desktop-shortcut').checked" $CreateDesktopShortcut
  ${NSD_WebView_GetValue} $WebUIBrowser "document.getElementById('start-menu-shortcut').checked" $CreateStartMenuShortcut
  
  ; Commencer l'installation effective
  Call InstallFiles
FunctionEnd

; Fonction d'installation des fichiers
Function InstallFiles
  ${INSTALL_TYPE}
  SetOutPath "$INSTDIR"
  SetOverwrite ifnewer
  
  ; Mise à jour de la progression
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('progress-bar').style.width = '10%';"
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('installation-info').innerHTML = 'Copie des fichiers principaux...';"
  
  ; Fichiers principaux
  File /r "dist\win-unpacked\*.*"
  
  ; Mise à jour de la progression
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('progress-bar').style.width = '50%';"
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('installation-info').innerHTML = 'Création des raccourcis...';"
  
  ; Création des raccourcis selon les choix
  ${If} $CreateStartMenuShortcut == "true"
    CreateDirectory "$SMPROGRAMS\${APP_NAME}"
    CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${MAIN_APP_EXE}"
  ${EndIf}
  
  ${If} $CreateDesktopShortcut == "true"
    CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${MAIN_APP_EXE}"
  ${EndIf}
  
  ; Mise à jour de la progression
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('progress-bar').style.width = '70%';"
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('installation-info').innerHTML = 'Enregistrement de l'application...';"
  
  ; Enregistrer dans le registre
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr ${REG_ROOT} "${REG_APP_PATH}" "" "$INSTDIR\${MAIN_APP_EXE}"
  WriteRegStr ${REG_ROOT} "${UNINSTALL_PATH}" "DisplayName" "${APP_NAME}"
  WriteRegStr ${REG_ROOT} "${UNINSTALL_PATH}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr ${REG_ROOT} "${UNINSTALL_PATH}" "DisplayIcon" "$INSTDIR\${MAIN_APP_EXE}"
  WriteRegStr ${REG_ROOT} "${UNINSTALL_PATH}" "DisplayVersion" "${VERSION}"
  WriteRegStr ${REG_ROOT} "${UNINSTALL_PATH}" "Publisher" "${COMP_NAME}"
  WriteRegStr ${REG_ROOT} "${UNINSTALL_PATH}" "URLInfoAbout" "${WEB_SITE}"
  
  ; Mise à jour de la progression
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('progress-bar').style.width = '90%';"
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('installation-info').innerHTML = 'Finalisation de l'installation...';"
  
  ; Installation personnalisée
  !insertmacro customInstall
  
  ; Installation complète
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('progress-bar').style.width = '100%';"
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('installation-info').innerHTML = 'Installation terminée avec succès!';"
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('install-button').innerHTML = '<i class=\"fa fa-play\"></i> Démarrer';"
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('install-button').disabled = false;"
  ${NSD_WebView_JS} $WebUIBrowser "document.getElementById('install-button').onclick = function() { window.external.launchApp(); };"
FunctionEnd

; Fonction pour lancer l'application
Function LaunchApp
  Exec "$INSTDIR\${MAIN_APP_EXE}"
  SendMessage $HWNDPARENT ${WM_CLOSE} 0 0
FunctionEnd

; Fonction pour fermer l'installateur
Function CloseInstaller
  SendMessage $HWNDPARENT ${WM_CLOSE} 0 0
FunctionEnd

; Fonction pour minimiser la fenêtre
Function MinimizeWindow
  System::Call "user32::FindWindow(t, t) i('$(^Name)', '') .r0"
  System::Call "user32::ShowWindow(i $0, i 6)"
FunctionEnd

; Fonction qui gère la page WebUI
Function PageWebUI
  !insertmacro WebUIShow
FunctionEnd

Function LeavePageWebUI
  ; Ne rien faire
FunctionEnd

; Page d'interface utilisateur personnalisée
Page Custom PageWebUI LeavePageWebUI

Section
  ; Section vide car l'installation est gérée par les fonctions
SectionEnd

Section Uninstall
  ${INSTALL_TYPE}
  
  ; Supprimer les raccourcis
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"
  
  ; Supprimer les fichiers installés
  RMDir /r "$INSTDIR"
  
  ; Supprimer les entrées de registre
  DeleteRegKey ${REG_ROOT} "${REG_APP_PATH}"
  DeleteRegKey ${REG_ROOT} "${UNINSTALL_PATH}"
  
  ; Désinstallation personnalisée
  !insertmacro customUnInstall
SectionEnd

; Liaison des fonctions JavaScript avec les fonctions NSIS
Function WebUIHandler
  Pop $0 ; Nom de la fonction
  
  ${If} $0 == "browseForFolder"
    Call BrowseDestination
  ${ElseIf} $0 == "startInstallation"
    Call StartInstallation
  ${ElseIf} $0 == "closeInstaller"
    Call CloseInstaller
  ${ElseIf} $0 == "minimizeWindow"
    Call MinimizeWindow
  ${ElseIf} $0 == "launchApp"
    Call LaunchApp
  ${EndIf}
FunctionEnd 