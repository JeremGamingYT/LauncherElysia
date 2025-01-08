const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const ejs = require('ejs');
const fs = require('fs');
const { Auth } = require('msmc');
const { Client } = require('minecraft-launcher-core');

// Configuration du stockage local
const store = new Store();
const authManager = new Auth("select_account");
const launcher = new Client();

// Fonction pour obtenir le chemin par défaut du dossier de jeu
function getDefaultGamePath() {
    const appDataPath = app.getPath('appData');
    return path.join(appDataPath, '.elysialauncher', 'minecraft');
}

// Fonction pour créer le dossier de jeu s'il n'existe pas
function ensureGameDirectory(gamePath) {
    try {
        if (!fs.existsSync(gamePath)) {
            fs.mkdirSync(gamePath, { recursive: true });
        }
        return true;
    } catch (error) {
        console.error('Erreur lors de la création du dossier:', error);
        return false;
    }
}

function createWindow() {
    // Création de la fenêtre principale
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        minWidth: 940,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        },
        frame: false
    });

    // Gestion des contrôles de fenêtre
    ipcMain.on('minimize-window', () => {
        mainWindow.minimize();
    });

    ipcMain.on('close-window', () => {
        mainWindow.close();
    });

    // Lecture et rendu du template EJS
    const templatePath = path.join(__dirname, 'views', 'index.ejs');
    const template = fs.readFileSync(templatePath, 'utf-8');

    // Préparation des chemins absolus pour les ressources
    const cssPath = path.join(__dirname, 'styles', 'main.css').replace(/\\/g, '/');
    const jsPath = path.join(__dirname, 'scripts', 'renderer.js').replace(/\\/g, '/');

    // Obtention du chemin du jeu sauvegardé ou utilisation du chemin par défaut
    const savedGamePath = store.get('game-directory') || getDefaultGamePath();
    ensureGameDirectory(savedGamePath);

    const html = ejs.render(template, {
        title: 'Launcher Elysia',
        versions: ['1.20.1', '1.19.4', '1.18.2'],
        memoryOptions: [2, 4, 6, 8],
        news: [
            {
                title: 'Bienvenue sur le Launcher Elysia!',
                content: 'Votre nouveau launcher Minecraft moderne et efficace.'
            },
            {
                title: 'Comment utiliser le launcher',
                content: 'Connectez-vous avec votre compte Microsoft, choisissez votre version et cliquez sur JOUER!'
            }
        ],
        cssPath: `file://${cssPath}`,
        jsPath: `file://${jsPath}`,
        gamePath: savedGamePath
    });

    // Écriture du HTML généré dans un fichier temporaire
    const tempPath = path.join(app.getPath('temp'), 'index.html');
    fs.writeFileSync(tempPath, html);

    // Chargement du fichier HTML généré
    mainWindow.loadFile(tempPath);

    // Ouvrir les outils de développement en mode dev
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }

    // Vérification de l'authentification au démarrage
    const savedToken = store.get('minecraft-token');
    if (savedToken) {
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow.webContents.send('auth-status', { 
                isAuthenticated: true,
                profile: store.get('minecraft-profile')
            });
        });
    }

    // Envoi du chemin du jeu au chargement
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('game-path', savedGamePath);
    });
}

// Gestion de la sélection du dossier
ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Sélectionner le dossier d\'installation de Minecraft',
        defaultPath: store.get('game-directory') || getDefaultGamePath()
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        if (ensureGameDirectory(selectedPath)) {
            store.set('game-directory', selectedPath);
            return { success: true, path: selectedPath };
        }
    }
    return { success: false };
});

// Gestion de la réinitialisation du chemin
ipcMain.handle('reset-directory', () => {
    const defaultPath = getDefaultGamePath();
    if (ensureGameDirectory(defaultPath)) {
        store.set('game-directory', defaultPath);
        return { success: true, path: defaultPath };
    }
    return { success: false };
});

// Création de la fenêtre quand l'app est prête
app.whenReady().then(createWindow);

// Gestion de la fermeture de l'application
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Gestion de l'authentification Microsoft
ipcMain.handle('microsoft-login', async () => {
  try {
    // Lancement de l'authentification Microsoft
    const xboxManager = await authManager.launch('electron');
    // Génération du token Minecraft
    const token = await xboxManager.getMinecraft();
    
    // Sauvegarde du token et du profil
    const profile = {
      name: token.profile.name,
      id: token.profile.id
    };
    
    store.set('minecraft-token', token.mclc());
    store.set('minecraft-profile', profile);
    
    return {
      success: true,
      profile: profile
    };
  } catch (error) {
    console.error('Erreur d\'authentification:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Gestion de la déconnexion
ipcMain.handle('logout', async () => {
  try {
    store.delete('minecraft-token');
    store.delete('minecraft-profile');
    return { success: true };
  } catch (error) {
    console.error('Erreur lors de la déconnexion:', error);
    return { success: false, error: error.message };
  }
});

// Mise à jour de la gestion du lancement du jeu pour utiliser le bon chemin
ipcMain.handle('launch-minecraft', async (event, options) => {
    try {
        const savedToken = store.get('minecraft-token');
        if (!savedToken) {
            throw new Error('Veuillez vous connecter avec votre compte Microsoft');
        }

        const gamePath = store.get('game-directory') || getDefaultGamePath();
        
        const opts = {
            clientPackage: null,
            authorization: savedToken,
            root: gamePath,
            version: {
                number: options.version,
                type: "release"
            },
            memory: {
                max: options.maxMemory || "2G",
                min: options.minMemory || "1G"
            }
        };

        launcher.launch(opts);

        launcher.on('debug', (e) => console.log(e));
        launcher.on('data', (e) => console.log(e));
        
        launcher.on('progress', (e) => {
            event.sender.send('download-progress', e);
        });

        return { success: true };
    } catch (error) {
        console.error('Erreur lors du lancement:', error);
        return { success: false, error: error.message };
    }
}); 