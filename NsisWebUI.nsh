; NsisWebUI.nsh
; Bibliothèque pour intégrer une interface utilisateur web dans les installateurs NSIS
; Cette bibliothèque simplifie l'intégration d'une interface HTML/CSS/JS dans NSIS

!ifndef NSISWEBUI_NSH_INCLUDED
!define NSISWEBUI_NSH_INCLUDED

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; Variables globales
Var WebUIDialog
Var WebUIBrowser

; Macro pour initialiser une interface utilisateur web
!macro WebUIInit
  ; Rien à faire pour l'instant
!macroend

; Macro pour créer et afficher la page web
!macro WebUIShow
  nsDialogs::Create 1044
  Pop $WebUIDialog
  
  ${If} $WebUIDialog == error
    Abort
  ${EndIf}
  
  ; Dimensionner le dialogue pour qu'il remplisse la page
  System::Call "user32::GetSystemMetrics(i 0) i .r0" ; SM_CXSCREEN
  System::Call "user32::GetSystemMetrics(i 1) i .r1" ; SM_CYSCREEN
  
  ; Enlever les bordures de la boîte de dialogue
  System::Call "user32::SetWindowLong(i $WebUIDialog, i -16, i 0x90000000|0x00C00000)"
  
  ; Créer le contrôle du navigateur web
  ${NSD_CreateWebView} 0 0 100% 100% "file://${WEBUI_PAGE}"
  Pop $WebUIBrowser
  
  ; Configurer le gestionnaire d'événements pour les fonctions JavaScript
  ${NSD_OnDialogInit} Call OnWebUIDialogInit
  
  nsDialogs::Show
!macroend

; Fonction appelée à l'initialisation du dialogue
Function OnWebUIDialogInit
  ; Créer un objet pour les callbacks JavaScript
  ${NSD_WebView_JSCallbacks} $WebUIBrowser "WebUIHandler"
FunctionEnd

; Ajouter une implémentation simplifiée de la fonction NSD_WebView_JS
!define NSD_WebView_JS "nsDialogs::WebViewJS"

; Ajouter une implémentation simplifiée de la fonction NSD_WebView_GetValue
!macro __NSD_WebView_GetValueCall _WEBBROWSER _SCRIPT _OUTPUT
System::Call 'nsDialogs::WebViewGetString(p ${_WEBBROWSER}, t "${_SCRIPT}", .r9)'
StrCpy ${_OUTPUT} $9
!macroend
!define NSD_WebView_GetValue '!insertmacro __NSD_WebView_GetValueCall'

; Ajouter une implémentation simplifiée de la fonction NSD_WebView_JSCallbacks
!define NSD_WebView_JSCallbacks "nsDialogs::WebViewJSCallback"

; Ajouter une implémentation simplifiée de la fonction NSD_WebView_NavigateFinish
!define NSD_WebView_NavigateFinish "nsDialogs::WebViewNavFinish"

; Fonction pour exécuter une fonction JavaScript
!macro _NSD_WebView_JSFunc _WEBBROWSER _CODE
  ${NSD_WebView_JS} ${_WEBBROWSER} "${_CODE}"
!macroend
!define NSD_WebView_JSFunc "!insertmacro _NSD_WebView_JSFunc"

!endif ; NSISWEBUI_NSH_INCLUDED 