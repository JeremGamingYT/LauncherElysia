!include MUI2.nsh
!include LogicLib.nsh
!include FileFunc.nsh

# Customize installer
!macro customInstall
  # Installation personnalisée
!macroend

# Custom welcome/finish pages
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Installation du Launcher Elysia"
  !define MUI_WELCOMEPAGE_TEXT "Bienvenue dans l'assistant d'installation du Launcher Elysia.$\r$\n$\r$\nCliquez sur Suivant pour continuer."
  !insertmacro MUI_PAGE_WELCOME
!macroend

# Customize the uninstaller
!macro customUnInstall
  # Code de désinstallation personnalisé
!macroend 