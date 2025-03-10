# Launcher Minecraft Personnalisable

Un launcher Minecraft moderne et élégant développé avec Electron, utilisant CSS, JavaScript et EJS.

> **Note importante**: Ce launcher est fourni sous licence ISC modifiée. Vous pouvez l'utiliser et le modifier librement, mais vous ne pouvez pas utiliser le nom "Elysia"/"Élysia" dans vos versions modifiées.

## Dernières mises à jour

### Update 15
- Version 1.5.4 du launcher

### Update 14
- Version 1.5.0 du launcher
- Nouveau module anti-cheat
- Gestion des ressources améliorée
- Nouvelle interface utilisateur
- Affichage des statistiques de jeu
- Ajout de 100 nouveaux mods

## Fonctionnalités

- Interface utilisateur moderne et intuitive
- Sélection de version de Minecraft
- Gestion de la mémoire RAM
- Affichage de l'avatar du joueur
- Barre de progression pour le téléchargement
- Section actualités personnalisable
- Gestionnaire de ressources intégré
- Support des shaders et resource packs
- Installation automatique des mods

## Prérequis

- Node.js (version 14 ou supérieure)
- npm (normalement installé avec Node.js)
- Java Runtime Environment (JRE) pour exécuter Minecraft

## Installation

1. Clonez le dépôt :
```bash
git clone [URL_DU_REPO]
cd LauncherElysia
```

2. Installez les dépendances :
```bash
npm install
```

## Développement

Pour lancer l'application en mode développement :
```bash
npm run dev
```

## Production

Pour construire l'application :
```bash
npm run build
```

## Structure du projet

```
LauncherElysia/
├── src/
│   ├── main.js           # Point d'entrée Electron
│   ├── views/            # Templates EJS
│   │   └── index.ejs
│   ├── styles/           # Fichiers CSS
│   │   └── main.css
│   ├── scripts/          # Scripts JavaScript
│   │   └── renderer.js
│   └── assets/          # Images et ressources
├── package.json
└── README.md
```

## Utilisation

1. Lancez l'application
2. Entrez votre nom d'utilisateur Minecraft
3. Sélectionnez la version de Minecraft souhaitée
4. Ajustez la mémoire RAM si nécessaire
5. Cliquez sur "JOUER" pour lancer le jeu

## Licence

ISC

## Contribution

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou à proposer une pull request. 