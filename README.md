# Elysia Launcher
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Version](https://img.shields.io/badge/version-1.6.5-brightgreen.svg)](https://github.com/JeremGamingYT/LauncherElysia/releases)
[![Stars](https://img.shields.io/github/stars/JeremGamingYT/LauncherElysia?style=social)](https://github.com/JeremGamingYT/LauncherElysia)
[![Downloads](https://img.shields.io/github/downloads/JeremGamingYT/LauncherElysia/total.svg)](https://github.com/JeremGamingYT/LauncherElysia/releases)

<div align="center">
  <img src="src/assets/icon.png" alt="Elysia Launcher Logo" width="200">
  <h3>Un launcher Minecraft moderne et élégant</h3>
</div>

## 🚀 Dernière mise à jour

### Version 1.6.5
- 🔒 Correction de vulnérabilités de sécurité
  - Mise à jour d'axios vers la version 1.8.2 pour corriger une vulnérabilité SSRF
  - Suppression de la dépendance discord vulnérable à ReDoS
  - Mise à jour des dépendances Octokit pour corriger des vulnérabilités ReDoS
- 📝 Documentation de sécurité améliorée et mise à jour

### Version 1.6.4
- 🧰 Correction du problème d'installation de Fabric
- 🔄 Téléchargement amélioré des fichiers d'installation
- 🛡️ Meilleure gestion des erreurs lors de l'installation
- 🔍 Vérifications plus robustes des fichiers essentiels
- ⚡ Installation plus fiable même avec une connexion instable

### Version 1.6.3
- 🔄 Amélioration de la recherche du fichier `resources.json`
- 🛠️ Correction du problème de double-clic pour lancer Minecraft
- 📂 Gestion optimisée du fichier `launcher_profiles.json`
- 🧩 Meilleure compatibilité avec l'installation des mods et ressources
- 🖥️ Interface utilisateur améliorée et plus réactive

## ✨ Fonctionnalités

| 🎮 Gameplay | 🛠️ Technique | 🎨 Interface |
|------------|--------------|-------------|
| Installation automatique de Fabric | Authentification Microsoft | Design moderne et intuitif |
| Support des shaders | Gestion intelligente de la mémoire RAM | Thème personnalisable |
| Resource packs pré-configurés | Auto-updater intégré | Affichage des statistiques de jeu |
| Plus de 100 mods inclus | Détection Java automatique | Barre de progression détaillée |
| Configuration optimisée | Installation silencieuse | Rich Presence Discord |

## 📋 Prérequis

- Windows 10/11 (64-bit)
- Connexion Internet
- 2 Go de RAM minimum (4 Go recommandés)
- Compte Microsoft

## 🔧 Installation

### Option 1: Installer via l'exécutable
1. Téléchargez la dernière version du launcher depuis la [page des releases](https://github.com/JeremGamingYT/LauncherElysia/releases)
2. Exécutez le fichier d'installation et suivez les instructions
3. Lancez "Elysia Launcher" depuis votre menu démarrer ou bureau

### Option 2: Construire à partir du code source
```bash
# Cloner le dépôt
git clone https://github.com/JeremGamingYT/LauncherElysia.git
cd LauncherElysia

# Installer les dépendances
npm install

# Lancer en mode développement
npm run dev

# Construire l'application
npm run build
```

## 🖥️ Utilisation

1. **Connexion** - Connectez-vous avec votre compte Microsoft
2. **Configuration** - Ajustez la mémoire RAM et autres paramètres au besoin
3. **Installation** - Le launcher installera automatiquement Minecraft, Fabric et les mods
4. **Jouer** - Cliquez sur "JOUER" pour lancer le jeu

## 🔒 Sécurité

Pour plus d'informations sur notre politique de sécurité et pour signaler des vulnérabilités, consultez notre [SECURITY.md](SECURITY.md).

## 📁 Structure du projet

```
LauncherElysia/
├── src/                 # Code source principal
│   ├── main.js          # Point d'entrée Electron
│   ├── modules/         # Modules spécifiques
│   ├── views/           # Templates EJS
│   ├── styles/          # Fichiers CSS
│   ├── scripts/         # Scripts JavaScript
│   └── assets/          # Images et ressources
├── plugins/             # Plugins du launcher
├── resources.json       # Configuration des ressources
└── package.json         # Configuration npm
```

## 📝 Licence

ISC - Voir le fichier LICENSE pour plus de détails.

> **Note importante**: Ce launcher est fourni sous licence ISC modifiée. Vous pouvez l'utiliser et le modifier librement, mais vous ne pouvez pas utiliser le nom "Elysia"/"Élysia" dans vos versions modifiées.

## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou à proposer une pull request.

## 📞 Support

En cas de problème, veuillez [ouvrir une issue](https://github.com/JeremGamingYT/LauncherElysia/issues) sur ce dépôt.

---

<div align="center">
  <p>Développé avec ❤️ par JeremGaming</p>
  <p>© 2024 Elysia</p>
</div> 