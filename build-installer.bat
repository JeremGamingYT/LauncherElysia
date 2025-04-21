@echo off
echo ======================================
echo Construction de l'installateur Elysia
echo ======================================
echo.

:: Vérifier la présence de Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo Erreur: Node.js n'est pas installé ou n'est pas dans le PATH.
  echo Veuillez installer Node.js depuis https://nodejs.org/
  exit /b 1
)

:: Vérifier la présence de NSIS
where makensis >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo Erreur: NSIS n'est pas installé ou n'est pas dans le PATH.
  echo Veuillez installer NSIS depuis https://nsis.sourceforge.io/Download
  exit /b 1
)

:: Installer les dépendances
echo Installation des dépendances...
call npm install || (
  echo Erreur lors de l'installation des dépendances.
  exit /b 1
)

:: Construire l'installateur
echo Construction de l'installateur...
call npm run create-installer || (
  echo Erreur lors de la construction de l'installateur.
  exit /b 1
)

echo.
echo Construction terminée avec succès!
echo L'installateur a été créé dans le dossier dist/elysia-setup.exe
echo.

exit /b 0 