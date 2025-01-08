const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const ejs = require('ejs');
const fs = require('fs-extra');
const { Auth } = require('msmc');
const { Client } = require('minecraft-launcher-core');
const { exec } = require('child_process');
const axios = require('axios');
const progress = require('progress-stream');
const crypto = require('crypto');
const os = require('os');
const { install, getVersionList } = require('@xmcl/installer');
const { MinecraftLocation } = require('@xmcl/core');

// Configuration du stockage local
const store = new Store();
const authManager = new Auth("select_account");

// Variables globales pour la gestion des processus
let gameProcess = null;
let mainWindow = null;
let authData = null;
let gameRunning = false;
let gameInstalled = false;

// Discord 'Rich presence'
const RPC = require('discord-rpc');
const clientId = '1296879619563327498';

// Crée un client RPC
const rpc = new RPC.Client({ transport: 'ipc' });

// Constantes pour Forge et chemins
const GAME_PATH = path.join(app.getPath('appData'), '.elysia');
const javaPath = store.get('java.path', 'C:\\Program Files\\Java\\jdk-17\\bin\\javaw.exe')
const FORGE_VERSION = '1.20.1-47.3.2';
const FORGE_VERSION_LAUNCHER = '1.20.1-forge-47.3.2';
const FORGE_INSTALLER_URL = `https://maven.minecraftforge.net/net/minecraftforge/forge/${FORGE_VERSION}/forge-${FORGE_VERSION}-installer.jar`;
const FORGE_INSTALLER_PATH = path.join(app.getPath('temp'), `forge-${FORGE_VERSION}-installer.jar`);

const tempDir = path.join(app.getPath('temp')); // Récupère le dossier Temp
const forgeInstallerName = 'forge-1.20.1-47.3.2-installer.jar'; // Nom du fichier
const forgePath = path.join(tempDir, forgeInstallerName); // Combine le chemin et le nom du fichier

// Fonction pour obtenir le chemin par défaut du dossier de jeu
function getDefaultGamePath() {
    const appDataPath = app.getPath('appData');
    return path.join(appDataPath, '.elysia');
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
    mainWindow = new BrowserWindow({
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

// Fonction pour vérifier l'intégrité des fichiers
async function verifyFiles(fileList, basePath) {
    for (const fileUrl of fileList) {
        const fileName = path.basename(fileUrl);
        const filePath = path.join(basePath, fileName);
        
        try {
            await fs.access(filePath);
        } catch (error) {
            console.log(`Fichier manquant: ${fileName}, retéléchargement nécessaire.`);
            return false;
        }
    }
    return true;
}

async function checkFileIntegrity(event) {
    const modsList = await fs.readJson(path.join(__dirname, 'mods.json'));
    const modsPath = path.join(app.getPath('appData'), '.elysia', 'mods');
    const modsValid = await verifyFiles(modsList, modsPath);
    return modsValid;
}

// Fonction pour télécharger Forge
async function downloadForge(event) {
    const writer = fs.createWriteStream(FORGE_INSTALLER_PATH);
    const response = await axios({
        url: FORGE_INSTALLER_URL,
        method: 'GET',
        responseType: 'stream'
    });

    const totalLength = response.headers['content-length'];
    const progressStream = progress({
        length: totalLength,
        time: 100
    });

    progressStream.on('progress', (progressData) => {
        const percentage = Math.round(progressData.percentage);
        event.sender.send('download-progress', percentage);
    });

    response.data.pipe(progressStream).pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// Fonction pour installer Forge
async function installForge(event) {
    return new Promise((resolve, reject) => {
        const javaPath = store.get('java.path', 'java');
        const command = `"${javaPath}" -jar "${FORGE_INSTALLER_PATH}" --installClient "${GAME_PATH}"`;

        const child = exec(command);

        child.stdout.on('data', (data) => {
            console.log(`Forge stdout: ${data}`);
            event.sender.send('install-progress', { stage: 'installing-forge', data });
        });

        child.stderr.on('data', (data) => {
            console.error(`Forge stderr: ${data}`);
        });

        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`L'installation de Forge a échoué avec le code ${code}`));
            } else {
                resolve();
            }
        });
    });
}

// Fonction pour installer les mods
async function installMods(event) {
    const modsJsonPath = path.join(__dirname, 'mods.json');
    const modsDestPath = path.join(app.getPath('appData'), '.elysia', 'mods');

    try {
        await fs.ensureDir(modsDestPath);

        // Lire la liste des mods à partir du fichier mods.json
        const modsList = await fs.readJson(modsJsonPath);
        const totalMods = modsList.length;
        let installedMods = 0;

        for (const modUrl of modsList) {
            const modName = path.basename(modUrl);
            const modPath = path.join(modsDestPath, modName);

            if (await fs.pathExists(modPath)) {
                console.log(`Le mod ${modName} est déjà installé, passage au suivant.`);
                installedMods++;
                continue;
            }

            console.log(`Téléchargement du mod : ${modName}`);
            event.sender.send('install-progress', { stage: 'downloading-mod', modName });

            const response = await axios.get(modUrl, { responseType: 'stream' });
            const writer = fs.createWriteStream(modPath);

            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            installedMods++;
            event.sender.send('install-progress', {
                stage: 'mod-progress',
                modName,
                progress: Math.round((installedMods / totalMods) * 100)
            });
        }

        event.sender.send('install-mods-reply', { success: true });
    } catch (error) {
        console.error(`Erreur lors de l'installation des mods: ${error.message}`);
        event.sender.send('install-mods-reply', { success: false });
        throw error;
    }
}

// Fonction pour installer Minecraft vanilla
async function installVanilla(event) {
    try {
        const versionList = await getVersionList();
        const version = versionList.versions.find(v => v.id === "1.20.1");
        
        if (!version) {
            throw new Error('Version 1.20.1 non trouvée');
        }

        event.sender.send('install-progress', { stage: 'installing-vanilla', message: 'Installation de Minecraft...' });
        
        await install(version, GAME_PATH, {
            onProgress: (task) => {
                const progress = Math.round((task.progress / task.total) * 100);
                event.sender.send('download-progress', progress);
            }
        });

        console.log('Installation de Minecraft vanilla terminée');
        return true;
    } catch (error) {
        console.error('Erreur lors de l\'installation de Minecraft vanilla:', error);
        throw error;
    }
}

// Handler d'installation de Forge modifié
ipcMain.handle('install-game', async (event) => {
    if (gameInstalled) {
        return { success: true, message: 'Le jeu est déjà installé.' };
    }

    try {
        await fs.ensureDir(GAME_PATH);
        
        // Installer Minecraft vanilla d'abord
        event.sender.send('install-progress', { stage: 'installing-vanilla', message: 'Installation de Minecraft...' });
        await installVanilla(event);

        // Puis installer Forge
        event.sender.send('install-progress', { stage: 'downloading-forge', message: 'Téléchargement de Forge...' });
        await downloadForge(event);
        
        event.sender.send('install-progress', { stage: 'installing-forge', message: 'Installation de Forge...' });
        await installForge(event);

        // Enfin installer les mods
        event.sender.send('install-progress', { stage: 'installing-mods', message: 'Installation des mods...' });
        await installMods(event);

        gameInstalled = true;
        store.set('gameInstalled', true);

        return { success: true, message: 'Installation terminée avec succès.' };
    } catch (error) {
        console.error('Erreur lors de l\'installation:', error);
        return { success: false, message: error.message };
    }
});

// Mise à jour de la gestion du lancement du jeu
ipcMain.handle('launch-minecraft', async (event, options) => {
    try {
        // Vérification des fichiers avant de lancer le jeu
        const filesValid = await checkFileIntegrity(event);
        
        if (!filesValid) {
            event.sender.send('install-play-message', { message: 'Des fichiers sont manquants ou corrompus, retéléchargement...' });
            await downloadForge(event);
            await installForge(event);
            await installMods(event);
        }

        const savedToken = store.get('minecraft-token');
        if (!savedToken) {
            throw new Error('Veuillez vous connecter avec votre compte Microsoft');
        }
        
        const opts = {
            clientPackage: null,
            authorization: savedToken,
            root: GAME_PATH,
            version: {
                number: '1.20.1',
                type: "release"
            },
            java: javaPath,
            forge: forgePath,
            memory: {
                max: options.maxMemory || "2G",
                min: options.minMemory || "1G"
            },
            window: {
                width: 1280,
                height: 720,
                fullscreen: false
            }
        };

        const launcher = new Client();
        launcher.launch(opts);

        launcher.on('debug', (e) => {
            const logPath = path.join(GAME_PATH, 'launcher.log');
            fs.appendFileSync(logPath, `${new Date().toISOString()} - ${e}\n`);
        });

        launcher.on('data', (e) => {
            const logPath = path.join(GAME_PATH, 'minecraft.log');
            fs.appendFileSync(logPath, `${new Date().toISOString()} - ${e}\n`);
        });

        launcher.on('progress', (e) => {
            if (e.type === 'download') {
                const progressPercent = Math.round((e.task / e.total) * 100);
                event.sender.send('download-progress', progressPercent);
            }
        });

        gameRunning = true;
        mainWindow.minimize();

        return { success: true };
    } catch (error) {
        console.error('Erreur lors du lancement:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('check-game-installation', async () => {
    const storedGameInstalled = store.get('gameInstalled', false);

    if (storedGameInstalled) {
        gameInstalled = true;
        return { installed: true };
    }

    try {
        await fs.access(path.join(GAME_PATH, 'versions', `1.20.1-forge-${FORGE_VERSION}`));
        gameInstalled = true;
        store.set('gameInstalled', true);
        return { installed: true };
    } catch (error) {
        gameInstalled = false;
        store.set('gameInstalled', false);
        return { installed: false };
    }
}); 