# Installateur personnalisé pour Elysia Launcher

Ce dossier contient les fichiers nécessaires pour créer un installateur personnalisé `elysia-setup.exe` pour le launcher Elysia.

## Prérequis

- Node.js 14 ou supérieur
- NSIS (Nullsoft Scriptable Install System) 3.0 ou supérieur
- Electron Builder

## Installation des prérequis

1. Installez [Node.js](https://nodejs.org/)
2. Installez [NSIS](https://nsis.sourceforge.io/Download)
3. Assurez-vous que NSIS est dans votre PATH système

## Fichiers d'installateur

- `elysia-installer.nsi` - Script principal NSIS pour l'installateur
- `installer.nsh` - Macros personnalisées pour l'installateur
- `installer.css` - Styles CSS pour l'interface de l'installateur
- `installer-page.html` - Page HTML personnalisée pour l'installateur
- `build-installer.js` - Script Node.js pour construire l'installateur

## Comment construire l'installateur

1. Installez les dépendances nécessaires:
   ```
   npm install
   ```

2. Générez l'installateur:
   ```
   npm run create-installer
   ```

3. L'installateur sera créé sous `dist/elysia-setup.exe`

## Personnalisation

- Vous pouvez personnaliser l'apparence de l'installateur en modifiant les fichiers `installer.css` et `installer-page.html`
- Les macros d'installation et de désinstallation peuvent être modifiées dans `installer.nsh`
- La configuration principale de l'installateur est dans `elysia-installer.nsi`

## Fonctionnalités

- Interface utilisateur personnalisée et moderne
- Détection et installation automatique de Java Runtime Environment
- Conservation des données utilisateur lors des mises à jour
- Support multilingue
- Vérification de la version de Windows
- Association de fichiers pour les fichiers `.elysia`
- Création automatique des dossiers requis

## Notes importantes

- L'installateur vérifie si une instance du launcher est en cours d'exécution avant l'installation
- L'installateur nécessite Windows 8.1 ou supérieur
- Les fichiers de configuration potentiellement problématiques sont supprimés lors des mises à jour

## Problèmes connus

- Si vous rencontrez des problèmes lors de la compilation NSIS, vérifiez que NSIS est correctement installé et dans votre PATH système
- Certaines protections antivirus peuvent bloquer la création de l'installateur

## Support

Pour toute question ou problème, veuillez contacter l'équipe Elysia via:
- Email: contact@elysia.fr
- Site web: https://elysia.fr 