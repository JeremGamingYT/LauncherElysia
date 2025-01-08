# Launcher Elysia

Un launcher Minecraft moderne et élégant développé avec Electron, utilisant CSS, JavaScript et EJS.

## Fonctionnalités

- Interface utilisateur moderne et intuitive
- Sélection de version de Minecraft
- Gestion de la mémoire RAM
- Affichage de l'avatar du joueur
- Barre de progression pour le téléchargement
- Section actualités personnalisable

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