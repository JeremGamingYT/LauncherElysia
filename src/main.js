const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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
const url = require('url');
const { install, getVersionList, installDependencies } = require('@xmcl/installer');
const { MinecraftLocation, Version } = require('@xmcl/core');
const { Agent } = require('undici');
const nbt = require('prismarine-nbt');
const AutoUpdater = require('./modules/auto-updater');
const ResourceManager = require('./modules/resource-manager');
// Anti-cheat désactivé pour éviter les faux positifs avec les antivirus
// const AntiCheat = require('./modules/anti-cheat');
const NewsModules = require('./modules/news');
const DiscordRPCManager = require('./modules/discord-rpc');
const net = require('net');

// Configuration du stockage local
const store = new Store({
    schema: {
        playTime: {
            type: 'number',
            default: 0
        }
    }
});
const authManager = new Auth("select_account");
const autoUpdater = new AutoUpdater('JeremGamingYT', 'LauncherElysia');

// Variables globales pour la gestion des processus
let gameProcess = null;
let mainWindow = null;
let authData = null;
let gameRunning = false;
let gameInstalled = false;
let splashWindow = null;
let gameStartTime = null;
let playTimeTracker = null;
let currentPlayTime = 0;

// Discord 'Rich presence'
const clientId = '1296879619563327498';
const discordRPC = new DiscordRPCManager(clientId);

// Constantes pour Fabric et chemins
const GAME_PATH = path.join(app.getPath('appData'), '.elysia');
const javaPath = store.get('java.path', 'C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe')
const FABRIC_VERSION = '0.16.10';
const FABRIC_VERSION_LAUNCHER = 'fabric-loader-0.16.10-1.21.1';
const FABRIC_INSTALLER_URL = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.1/fabric-installer-1.0.1.jar`;
const FABRIC_INSTALLER_PATH = path.join(app.getPath('temp'), `fabric-installer-1.0.1.jar`);

const tempDir = path.join(app.getPath('temp')); // Récupère le dossier Temp
const fabricInstallerName = 'fabric-installer-1.0.1.jar'; // Nom du fichier
const fabricPath = path.join(tempDir, fabricInstallerName); // Combine le chemin et le nom du fichier

// Constantes pour Java
const JAVA_INSTALLER_FILENAME = 'jdk-21.0.5_windows-x64_bin.exe';
const JAVA_DOWNLOAD_URL = 'https://download.oracle.com/java/21/archive/jdk-21.0.5_windows-x64_bin.exe';
const JAVA_LOCAL_PATH = path.join(__dirname, '..', 'download', JAVA_INSTALLER_FILENAME);
const JAVA_INSTALLER_PATH = path.join(app.getPath('temp'), 'jdk-21-installer.exe');

// Ajouter avec les autres constantes
const resourceManager = new ResourceManager(GAME_PATH);
// Anti-cheat désactivé pour éviter les faux positifs avec les antivirus
// const antiCheat = new AntiCheat(GAME_PATH);

// Configurer le serveur pour l'anti-cheat
const SERVER_NAME = "Elysia";

// News API configuration - utilisation d'un fichier JSON hébergé sur GitHub
const newsJsonUrl = 'https://raw.githubusercontent.com/JeremGamingYT/LauncherElysia/main/news.json';

// Initialiser les gestionnaires d'actualités et de mises à jour
const discordNewsManager = new NewsModules.DiscordNewsManager({
    newsUrl: newsJsonUrl,
    limit: 10
});

const updatesManager = new NewsModules.UpdatesManager({
    remoteUrl: 'https://raw.githubusercontent.com/JeremGamingYT/LauncherElysia/main/updates.json',
    owner: 'JeremGamingYT',
    repo: 'LauncherElysia'
});

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

// Fonction pour vérifier Java au démarrage
async function checkJavaAtStartup() {
    try {
        const javaValid = await verifyJavaInstallation();
        
        if (!javaValid && mainWindow) {
            mainWindow.webContents.on('did-finish-load', () => {
                mainWindow.webContents.send('java-missing', {
                    message: 'Java 21 n\'est pas installé',
                    details: 'Java 21 est nécessaire pour lancer le jeu. Cliquez sur "Installer" pour l\'installer automatiquement.'
                });
            });
        }
        
        return javaValid;
    } catch (error) {
        console.error('Erreur lors de la vérification de Java au démarrage:', error);
        return false;
    }
}

function createWindow() {
    // Charger les données pour le template
    let news = [];
    let updates = [];

    // Essayer de charger les mises à jour localement
    try {
        updates = store.get('updates', []);
    } catch (error) {
        console.error('Erreur lors du chargement des mises à jour:', error);
    }

    // Détecter la version de Windows
    const isWindows11 = os.release().startsWith('10.0.2') || parseFloat(os.release().split('.')[2]) >= 22000;
    
    // Créer la fenêtre principale avec les données
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1280,
        minHeight: 800,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        },
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        roundedCorners: true,
        show: false // Ne pas afficher immédiatement pour éviter les flashs
    });

    // Appliquer CSS pour les bords arrondis sur Windows
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.insertCSS(`
            body, html {
                border-radius: 10px !important;
                overflow: hidden !important;
            }
            .container, #app, .window-frame, .main {
                border-radius: 10px !important;
                overflow: hidden !important;
            }
            .titlebar {
                border-top-left-radius: 10px !important;
                border-top-right-radius: 10px !important;
            }
            .sidebar {
                border-bottom-left-radius: 10px !important;
            }
            .main {
                border-bottom-right-radius: 10px !important;
            }
        `);

        // Activer la vibrancy sous Windows 10/11 pour améliorer l'effet de transparence
        if (process.platform === 'win32') {
            try {
                mainWindow.setVibrancy('dark');
            } catch (e) {
                console.log('Vibrancy not supported', e);
            }
        }
    });

    // Gestion des contrôles de fenêtre
    ipcMain.on('minimize-window', () => {
        mainWindow.minimize();
    });

    ipcMain.on('close-window', async () => {
        try {
            // Si Minecraft est en cours d'exécution, on le tue d'abord
            if (gameRunning) {
                await killMinecraftProcess();
                gameRunning = false;
            }
            
            // On force la destruction de la fenêtre pour s'assurer qu'elle se ferme
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.destroy();
            }
            
            // Quitter l'application
            app.quit();
        } catch (error) {
            console.error('Erreur lors de la fermeture:', error);
            // En cas d'erreur, on force quand même la fermeture
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.destroy();
            }
            app.exit(0);
        }
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
        title: 'Elysia - v.2.0.5 (BETA)',
        versions: ['2.0.5'],
        news: news,
        updates: updates,
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
        mainWindow.webContents.send('game-path', GAME_PATH);
        
        // Force les bords arrondis en redimensionnant légèrement la fenêtre
        const size = mainWindow.getSize();
        mainWindow.setSize(size[0] + 1, size[1]);
        setTimeout(() => {
            mainWindow.setSize(size[0], size[1]);
            // Afficher la fenêtre principale une fois prête
            if (!mainWindow.isVisible()) {
                mainWindow.show();
            }
        }, 100);
    });

    // Vérifier Java au démarrage
    checkJavaAtStartup();

    mainWindow.on('close', async (event) => {
        if (gameRunning) {
            event.preventDefault(); // Empêcher la fermeture immédiate
            await killMinecraftProcess();
            gameRunning = false;
            mainWindow.destroy(); // Fermer la fenêtre après avoir tué le processus
        }
    });
}

async function createSplashWindow() {
    // Détecter la version de Windows
    const isWindows11 = os.release().startsWith('10.0.2') || parseFloat(os.release().split('.')[2]) >= 22000;
    
    splashWindow = new BrowserWindow({
        width: 400,
        height: 400,
        frame: false,
        transparent: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        center: true,
        resizable: false,
        skipTaskbar: true,
        backgroundColor: '#00000000',
        roundedCorners: true,
        show: false // Ne pas afficher immédiatement pour éviter les flashs
    });

    const templatePath = path.join(__dirname, 'views', 'splash.ejs');
    const template = fs.readFileSync(templatePath, 'utf-8');
    const logoPath = path.join(__dirname, 'assets', 'logo.png').replace(/\\/g, '/');
    const bgImagePath = path.join(__dirname, 'assets', 'backgrounds', 'elysia.jpg').replace(/\\/g, '/');
    
    const html = ejs.render(template, {
        version: app.getVersion(),
        logoPath: `file://${logoPath}`,
        bgImagePath: `file://${bgImagePath}`
    });

    const tempPath = path.join(app.getPath('temp'), 'splash.html');
    fs.writeFileSync(tempPath, html);
    splashWindow.loadFile(tempPath);

    // Appliquer CSS pour les bords arrondis
    splashWindow.webContents.on('did-finish-load', () => {
        splashWindow.webContents.insertCSS(`
            body, html {
                border-radius: 10px !important;
                overflow: hidden !important;
            }
            .splash-container {
                border-radius: 10px !important;
                overflow: hidden !important;
            }
        `);

        // Activer la vibrancy pour améliorer l'effet de transparence
        if (process.platform === 'win32') {
            try {
                splashWindow.setVibrancy('dark');
            } catch (e) {
                console.log('Vibrancy not supported', e);
            }
        }

        // Afficher la fenêtre une fois que tout est chargé
        splashWindow.show();
        
        // Force les bords arrondis en redimensionnant légèrement la fenêtre
        const size = splashWindow.getSize();
        splashWindow.setSize(size[0] + 1, size[1]);
        setTimeout(() => {
            splashWindow.setSize(size[0], size[1]);
        }, 100);
    });

    // Attendre que la fenêtre soit prête
    await new Promise(resolve => splashWindow.once('ready-to-show', resolve));
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

// Fonction pour vérifier les mises à jour au démarrage
async function checkForUpdates() {
    try {
        const updateInfo = await autoUpdater.checkForUpdates();
        if (updateInfo.hasUpdate) {
            const { response } = await dialog.showMessageBox({
                type: 'info',
                title: 'Mise à jour disponible',
                message: `Une nouvelle version (${updateInfo.version}) est disponible. Voulez-vous la télécharger et l'installer ?`,
                buttons: ['Oui', 'Non']
            });

            if (response === 0) {
                try {
                    const setupPath = await autoUpdater.downloadUpdate(updateInfo.downloadUrl);
                    await autoUpdater.installUpdate(setupPath);
                } catch (error) {
                    await dialog.showMessageBox({
                        type: 'error',
                        title: 'Erreur de mise à jour',
                        message: 'Une erreur est survenue lors de la mise à jour. Veuillez réessayer plus tard.',
                        buttons: ['OK']
                    });
                }
            }
        }
    } catch (error) {
        console.error('Erreur lors de la vérification des mises à jour:', error);
    }
}

// Vérification des mises à jour au démarrage de l'application
app.whenReady().then(async () => {
    await createSplashWindow();
    await createWindow(); // Créer la fenêtre principale d'abord
    mainWindow.hide(); // La cacher temporairement

    try {
        // Tenter de rafraîchir le token au démarrage
        if (store.get('minecraft-token-refresh')) {
            await refreshMinecraftToken();
        }
        
        // Vérification des mises à jour
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.webContents.send('splash-status', {
                message: 'Recherche de mises à jour...',
                progress: 10
            });
        }

        const updateInfo = await autoUpdater.checkForUpdates();
        
        if (updateInfo.hasUpdate && updateInfo.downloadUrl) {
            if (splashWindow && !splashWindow.isDestroyed()) {
                splashWindow.webContents.send('splash-status', {
                    message: 'Téléchargement de la mise à jour...',
                    progress: 20
                });
            }

            // Écoutez les événements de progression du téléchargement
            autoUpdater.on('download-progress', (progressObj) => {
                if (splashWindow && !splashWindow.isDestroyed()) {
                    splashWindow.webContents.send('splash-status', {
                        message: `Téléchargement: ${Math.round(progressObj.percent)}%`,
                        progress: 20 + (progressObj.percent * 0.6)
                    });
                }
            });
            
            const setupPath = await autoUpdater.downloadUpdate(updateInfo.downloadUrl);

            if (splashWindow && !splashWindow.isDestroyed()) {
                splashWindow.webContents.send('splash-status', {
                    message: 'Installation de la mise à jour...',
                    progress: 80
                });
            }

            await autoUpdater.installUpdate(setupPath);
        }

        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.webContents.send('splash-status', {
                message: 'Chargement des configurations...',
                progress: 90
            });
        }
        await loadConfigurations();

        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.webContents.send('splash-status', {
                message: 'Préparation du launcher...',
                progress: 95
            });
        }

        // Finalisation
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.webContents.send('splash-status', {
                message: 'Démarrage...',
                progress: 100
            });
        }

        // Attendre un court instant pour montrer 100%
        await new Promise(resolve => setTimeout(resolve, 500));

        // Afficher la fenêtre principale seulement à la fin
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.close();
        }
        if (!mainWindow.isVisible()) {
            // Force les bords arrondis avant d'afficher
            const size = mainWindow.getSize();
            mainWindow.setSize(size[0] + 1, size[1]);
            setTimeout(() => {
                mainWindow.setSize(size[0], size[1]);
                mainWindow.show();
            }, 100);
        } else {
            mainWindow.focus();
        }

    } catch (error) {
        console.error('Erreur lors du démarrage:', error);
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.webContents.send('splash-error', {
                message: `Erreur: ${error.message}`
            });
        }
    }
});

// Gestion de la fermeture de l'application
app.on('window-all-closed', async () => {
    if (gameRunning) {
        await killMinecraftProcess();
    }
    
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
    
    // Sauvegarder le token de rafraîchissement pour les futures sessions
    store.set('minecraft-token-refresh', xboxManager.msToken.refresh_token);
    
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

// Vérification manuelle des mises à jour
ipcMain.handle('check-updates', async () => {
  try {
    return await checkForUpdates();
  } catch (error) {
    console.error('Erreur lors de la vérification des mises à jour:', error);
    return { success: false, error: error.message };
  }
});

// Fonction pour calculer le hash SHA-256 d'un fichier
async function calculateFileHash(filePath) {
    try {
        const fileBuffer = await fs.readFile(filePath);
        return crypto.createHash('sha256').update(fileBuffer).digest('hex');
    } catch (error) {
        console.error(`Erreur lors du calcul du hash pour ${filePath}:`, error);
        return null;
    }
}

// Fonction pour vérifier l'intégrité d'un seul mod
async function verifyMod(modUrl, modPath) {
    try {
        // Vérifier si le fichier existe
        if (!await fs.pathExists(modPath)) {
            console.log(`Mod manquant: ${path.basename(modPath)}`);
            return { exists: false, needsUpdate: true };
        }

        // Télécharger temporairement les informations du fichier distant pour comparer la taille
        const response = await axios.head(modUrl);
        const remoteSize = parseInt(response.headers['content-length']);
        const localStats = await fs.stat(modPath);

        // Si les tailles sont différentes, le fichier doit être mis à jour
        if (remoteSize !== localStats.size) {
            console.log(`Taille différente pour ${path.basename(modPath)}`);
            return { exists: true, needsUpdate: true };
        }

        return { exists: true, needsUpdate: false };
    } catch (error) {
        console.error(`Erreur lors de la vérification de ${path.basename(modPath)}:`, error);
        return { exists: false, needsUpdate: true };
    }
}

// Modifier la fonction verifyFiles pour être plus tolérante sur les vérifications
async function verifyFiles(event, modsList) {
    try {
        if (!Array.isArray(modsList)) {
            console.warn('modsList invalide, utilisation tableau vide');
            modsList = [];
        }

        const modsPath = path.join(GAME_PATH, 'mods');
        await fs.ensureDir(modsPath);

        // On vérifie uniquement si les fichiers existent, pas leur contenu
        const verificationResults = await Promise.all(
            modsList.map(async (mod) => {
                const fileName = path.basename(new URL(mod.url).pathname);
                const filePath = path.join(modsPath, fileName);
                
                // Vérifier l'existence du fichier uniquement
                const exists = await fs.pathExists(filePath);
                
                // Si le fichier existe et a une taille > 0, on le considère comme valide
                if (exists) {
                    try {
                        const stats = await fs.stat(filePath);
                        if (stats.size > 0) {
                            return { file: fileName, status: 'valid' };
                        }
                    } catch (e) {
                        console.error(`Erreur lors de la vérification de ${fileName}:`, e);
                    }
                }
                
                return { file: fileName, status: 'missing' };
            })
        );

        return {
            missingFiles: verificationResults.filter(r => r.status === 'missing').map(r => r.file),
            // On ne se préoccupe plus des fichiers "modifiés"
            modifiedFiles: []
        };
    } catch (error) {
        console.error('Erreur vérification fichiers:', error);
        throw error;
    }
}

// Fonction pour installer un seul mod
async function installSingleMod(modUrl, modPath, event) {
    try {
        console.log(`Tentative de téléchargement du mod depuis: ${modUrl}`);
        const response = await axios.get(modUrl, { 
            responseType: 'stream',
            validateStatus: function (status) {
                return status >= 200 && status < 300; // Par défaut, seuls les statuts 2xx sont acceptés
            }
        });
        
        const writer = fs.createWriteStream(modPath);

        return new Promise((resolve, reject) => {
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.error(`Mod non trouvé (404): ${path.basename(modPath)}`);
            // On peut ici décider de continuer sans ce mod
            // Pour éviter de bloquer tout le processus
            return Promise.resolve();
        }
        console.error(`Erreur lors de l'installation du mod ${path.basename(modPath)}:`, error.message);
        throw error;
    }
}

// Fonction optimisée pour installer uniquement les mods nécessaires
async function installMissingMods(modsToInstall, targetDir, event) {
    try {
        await fs.ensureDir(targetDir);
        
        for (const mod of modsToInstall) {
            const fileName = path.basename(new URL(mod.url).pathname);
            const modPath = path.join(targetDir, fileName);
            
            event.sender.send('install-progress', {
                stage: 'downloading-mod',
                modName: fileName
            });

            await installSingleMod(mod.url, modPath, event);
        }
        return true;
    } catch (error) {
        console.error('Erreur installation mods:', error);
        return false;
    }
}

// Modifier la fonction checkFileIntegrity pour une vérification plus réaliste
async function checkFileIntegrity(event) {
    try {
        // Vérifier si le dossier mods existe
        const modsDir = path.join(GAME_PATH, 'mods');
        if (!await fs.pathExists(modsDir)) {
            console.log('Dossier mods manquant');
            return false;
        }
        
        // Vérifier le contenu du dossier
        const modsFiles = await fs.readdir(modsDir);
        
        // Si le dossier contient des fichiers, considérer que l'installation est valide
        if (modsFiles.length > 0) {
            console.log(`Le dossier mods contient ${modsFiles.length} fichiers, considéré comme valide.`);
            return true;
        }
        
        console.log('Dossier mods vide');
        return false;
    } catch (error) {
        console.error('Erreur de vérification:', error);
        return false;
    }
}

// Fonction pour télécharger Fabric
async function downloadFabric(event) {
    try {
        // Vérifier si le chemin existe, sinon le créer
        const tempDir = path.dirname(FABRIC_INSTALLER_PATH);
        await fs.ensureDir(tempDir);
        
        // Supprimer le fichier s'il existe déjà mais est corrompu
        if (await fs.pathExists(FABRIC_INSTALLER_PATH)) {
            await fs.remove(FABRIC_INSTALLER_PATH);
            console.log('Fichier Fabric existant supprimé pour assurer un téléchargement propre');
        }
        
        const writer = fs.createWriteStream(FABRIC_INSTALLER_PATH);
        console.log(`Téléchargement de Fabric depuis ${FABRIC_INSTALLER_URL} vers ${FABRIC_INSTALLER_PATH}`);
        
        const response = await axios({
            url: FABRIC_INSTALLER_URL,
            method: 'GET',
            responseType: 'stream',
            timeout: 30000 // 30 secondes de timeout
        });

        const totalLength = response.headers['content-length'];
        const progressStream = progress({
            length: totalLength,
            time: 100
        });

        progressStream.on('progress', (progressData) => {
            const percentage = Math.round(progressData.percentage);
            event.sender.send('download-progress', percentage);
            console.log(`Progression du téléchargement Fabric: ${percentage}%`);
        });

        response.data.pipe(progressStream).pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', async () => {
                // Vérifier que le fichier existe et n'est pas vide
                try {
                    const stats = await fs.stat(FABRIC_INSTALLER_PATH);
                    if (stats.size > 0) {
                        console.log(`Téléchargement de Fabric terminé, taille: ${stats.size} octets`);
                        resolve();
                    } else {
                        console.error('Le fichier JAR de Fabric a été téléchargé mais est vide');
                        reject(new Error('Le fichier JAR de Fabric est vide'));
                    }
                } catch (err) {
                    console.error('Erreur lors de la vérification du fichier Fabric:', err);
                    reject(err);
                }
            });
            writer.on('error', (err) => {
                console.error('Erreur lors du téléchargement de Fabric:', err);
                reject(err);
            });
        });
    } catch (error) {
        console.error('Erreur critique lors du téléchargement de Fabric:', error);
        throw error;
    }
}

// Modifier la fonction d'installation de Fabric pour la rendre plus tolérante
async function installFabric(event) {
    try {
        // Vérifier que le fichier existe avant de l'utiliser
        if (!await fs.pathExists(FABRIC_INSTALLER_PATH)) {
            console.error(`Le fichier d'installation Fabric n'existe pas à l'emplacement: ${FABRIC_INSTALLER_PATH}`);
            event.sender.send('install-progress', { 
                stage: 'error', 
                message: 'Le fichier Fabric n\'a pas pu être téléchargé. Nouvelle tentative...' 
            });
            
            // Nouvelle tentative de téléchargement
            await downloadFabric(event);
            
            // Vérifier à nouveau
            if (!await fs.pathExists(FABRIC_INSTALLER_PATH)) {
                throw new Error('Impossible de télécharger le fichier Fabric après plusieurs tentatives');
            }
        }
        
        // Vérifier que le fichier n'est pas vide
        const stats = await fs.stat(FABRIC_INSTALLER_PATH);
        if (stats.size === 0) {
            console.error('Le fichier JAR de Fabric existe mais est vide');
            throw new Error('Le fichier JAR de Fabric est corrompu (taille zéro)');
        }
        
        return new Promise((resolve, reject) => {
            const javaPath = store.get('java.path', 'java');
            const command = `"${javaPath}" -jar "${FABRIC_INSTALLER_PATH}" client -dir "${GAME_PATH}" -mcversion 1.21.1 -loader ${FABRIC_VERSION}`;

            console.log('Commande d\'installation Fabric:', command);

            const child = exec(command);

            child.stdout.on('data', (data) => {
                console.log(`Fabric stdout: ${data}`);
                event.sender.send('install-progress', { stage: 'installing-fabric', data });
            });

            child.stderr.on('data', (data) => {
                console.error(`Fabric stderr: ${data}`);
            });

            child.on('close', (code) => {
                if (code !== 0) {
                    console.warn(`Installation de Fabric échouée avec le code ${code} - continuation sans Fabric`);
                    resolve(false); // On résout au lieu de rejeter
                } else {
                    console.log('Installation de Fabric réussie');
                    resolve(true);
                }
            });
        });
    } catch (error) {
        console.error('Erreur lors de l\'installation de Fabric:', error);
        return false;
    }
}

// Modifier la fonction verifyModsInstallation
async function verifyModsInstallation() {
    try {
        const modsPath = path.join(app.getPath('appData'), '.elysia', 'mods');
        await fs.ensureDir(modsPath);
        
        // Vérifier si le dossier mods existe
        const modsFiles = await fs.readdir(modsPath);
        
        // Si le dossier est vide, retourner false
        if (modsFiles.length === 0) {
            console.log('Le dossier mods est vide');
            return false;
        }
        
        // Vérifier les mods spécifiques (optionnel)
        const resourcesData = await fs.readJson(path.join(__dirname, 'resources.json'));
        const modsList = resourcesData.mods; // Accéder au tableau "mods" dans le fichier resources.json
        
        if (!modsList || !Array.isArray(modsList)) {
            console.error("Le tableau de mods n'a pas été trouvé ou n'est pas valide");
            return false;
        }
        
        // Créer une map de noms de fichier pour la recherche rapide
        const existingFilesMap = new Map(modsFiles.map(f => [f.toLowerCase(), true]));
        
        // Vérifier si tous les mods nécessaires sont présents
        const missingMods = [];
        for (const mod of modsList) {
            const fileName = path.basename(new URL(mod.url).pathname).toLowerCase();
            if (!existingFilesMap.has(fileName)) {
                console.log(`Mod manquant: ${fileName}`);
                missingMods.push(mod);
            }
        }
        
        // Si des mods sont manquants, stocker la liste pour une installation sélective
        if (missingMods.length > 0) {
            console.log(`${missingMods.length} mods manquants sur ${modsList.length}`);
            store.set('missing-mods', missingMods);
            return false;
        }
        
        console.log('Tous les mods sont installés');
        store.delete('missing-mods'); // Nettoyer la liste des mods manquants
        return true;
    } catch (error) {
        console.error('Erreur lors de la vérification des mods:', error);
        return false;
    }
}

// Nouvelle version avec détection du mode production et meilleure gestion d'erreurs
async function installMods(event) {
    try {
        // Vérifier s'il y a une liste de mods manquants
        let modsToInstall = store.get('missing-mods');
        
        // Si pas de liste spécifique, installer tous les mods
        if (!modsToInstall || !Array.isArray(modsToInstall) || modsToInstall.length === 0) {
            // Récupérer le chemin du fichier resources.json
            const resourcesJsonPath = await findResourcesJsonPath();
            const resourcesData = await fs.readJson(resourcesJsonPath);
            modsToInstall = resourcesData.mods;
            
            if (!modsToInstall || !Array.isArray(modsToInstall)) {
                throw new Error("Impossible de charger la liste des mods");
            }
        }
        
        const modsDestPath = path.join(app.getPath('appData'), '.elysia', 'mods');
        await fs.ensureDir(modsDestPath);
        
        const totalMods = modsToInstall.length;
        let installedMods = 0;
        let failedMods = 0;
        let notFoundMods = [];
    
        event.sender.send('install-progress', {
            stage: 'installing-mods',
            progress: 0,
            message: `Installation de ${totalMods} mods...`
        });
    
        for (const mod of modsToInstall) {
            const modName = path.basename(mod.url);
            const modPath = path.join(modsDestPath, modName);
    
            event.sender.send('install-progress', {
                stage: 'installing-mod',
                progress: Math.round((installedMods / totalMods) * 100),
                message: `Installation de ${modName} (${installedMods + 1}/${totalMods})`
            });
    
            try {
                await installSingleMod(mod.url, modPath, event);
                installedMods++;
            } catch (error) {
                if (error.response && error.response.status === 404) {
                    console.error(`Mod non trouvé (404): ${modName}`);
                    notFoundMods.push(modName);
                } else {
                    console.error(`Erreur lors de l'installation du mod ${modName}:`, error.message);
                }
                failedMods++;
                // Continue despite the error
            }
        }
    
        // Message en fonction du résultat
        if (failedMods === 0) {
            event.sender.send('install-progress', {
                stage: 'complete',
                progress: 100,
                message: `${installedMods} mods installés avec succès`
            });
        } else {
            let message = `${installedMods} mods installés, ${failedMods} mods n'ont pas pu être installés`;
            if (notFoundMods.length > 0) {
                message += `. Mods non trouvés: ${notFoundMods.join(', ')}`;
            }
            event.sender.send('install-progress', {
                stage: 'complete-with-errors',
                progress: 100,
                message: message
            });
        }
        
        // Nettoyer la liste des mods manquants après l'installation
        store.delete('missing-mods');
    
        return true;
    } catch (error) {
        console.error('Erreur lors de l\'installation des mods:', error);
        event.sender.send('install-progress', {
            stage: 'error',
            message: `Erreur: ${error.message}`
        });
        throw error;
    }
}

// Fonction pour lancer Minecraft vanilla temporairement
async function launchVanillaTemporary(event) {
    try {
        event.sender.send('install-progress', { stage: 'launching-vanilla', message: 'Lancement de Minecraft vanilla...' });
        
        const opts = {
            clientPackage: null,
            authorization: store.get('minecraft-token'),
            root: GAME_PATH,
            version: {
                number: '1.21.1',
                type: "release"
            },
            memory: {
                max: "2G",
                min: "1G"
            }
        };

        const launcher = new Client();
        
        return new Promise((resolve, reject) => {
            let gameStarted = false;
            
            launcher.on('data', (data) => {
                console.log('Minecraft output:', data);
                // Détecter quand le jeu est complètement chargé
                if (data.includes('Setting user:') && !gameStarted) {
                    gameStarted = true;
                    // Attendre 10 secondes puis fermer le jeu
                    setTimeout(() => {
                        event.sender.send('install-progress', { stage: 'closing-vanilla', message: 'Fermeture de Minecraft...' });
                        process.kill(launcher.pid);
                        resolve();
                    }, 10000);
                }
            });

            launcher.on('close', (code) => {
                if (!gameStarted) {
                    reject(new Error('Le jeu s\'est fermé avant d\'être complètement chargé'));
                }
            });

            launcher.launch(opts);
        });
    } catch (error) {
        console.error('Erreur lors du lancement temporaire de Minecraft:', error);
        throw error;
    }
}

// Modification de la fonction installVanilla
async function installVanilla(event) {
    try {
        const version = await getVersionList().then(list => list.versions.find(v => v.id === '1.21.1'));
        
        // Configuration de l'agent de téléchargement
        const agent = new Agent({
            connections: 16,
            pipelining: 1
        });

        const downloadOptions = {
            agent: {
                dispatcher: agent
            },
            maxConcurrency: 16,
            side: 'client'
        };

        console.log('Début de l\'installation de Minecraft vanilla');
        event.sender.send('installation-progress', 'Installation de Minecraft vanilla en cours...');

        // Installation de la version
        await install(version, GAME_PATH, downloadOptions);
        
        // Installation des dépendances (bibliothèques et assets)
        const resolvedVersion = await Version.parse(GAME_PATH, '1.21.1');
        await installDependencies(resolvedVersion, downloadOptions);

        console.log('Installation de Minecraft vanilla terminée');
        return true;
    } catch (error) {
        console.error('Erreur lors de l\'installation de Minecraft vanilla:', error);
        
        if (error.name === 'DownloadAggregateError') {
            console.error('Détails des erreurs de téléchargement:', error.errors);
            throw new Error('Erreur lors du téléchargement des fichiers Minecraft. Veuillez vérifier votre connexion internet et réessayer.');
        }
        
        throw error;
    }
}

// Fonction pour vérifier l'installation de Java
async function verifyJavaInstallation() {
    try {
        const defaultJavaPath = 'C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe';
        const storedJavaPath = store.get('java.path', defaultJavaPath);

        // Vérification du chemin stocké
        try {
            await fs.access(storedJavaPath);
            console.log('Java 21 trouvé à:', storedJavaPath);
            return true;
        } catch (err) {
            console.log('Chemin Java stocké non trouvé:', storedJavaPath);
        }

        // Vérifications de chemins communs d'installation de Java 21
        const commonPaths = [
            'C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe',
            'C:\\Program Files\\Java\\jdk-21.0.5\\bin\\javaw.exe',
            'C:\\Program Files\\Java\\jdk-21.0.0\\bin\\javaw.exe',
            'C:\\Program Files (x86)\\Java\\jdk-21\\bin\\javaw.exe'
        ];

        for (const javaPath of commonPaths) {
            try {
                await fs.access(javaPath);
                console.log('Java 21 trouvé à:', javaPath);
                // Mettre à jour le chemin Java dans le store
                store.set('java.path', javaPath);
                return true;
            } catch (err) {
                // continue
            }
        }

        // Vérification via commande
        return new Promise((resolve) => {
            exec('java -version', (error, stdout, stderr) => {
                if (error) {
                    console.log('Commande java -version a échoué:', error);
                    resolve(false);
                    return;
                }
                
                // Vérifier si Java 21 est disponible
                const output = stderr || stdout;
                console.log('Version Java détectée:', output);
                
                if (output.includes('21.') || output.includes('version "21')) {
                    console.log('Java 21 détecté via commande');
                    resolve(true);
                } else {
                    console.log('Java 21 non détecté via commande');
                    resolve(false);
                }
            });
        });
    } catch (error) {
        console.error('Erreur lors de la vérification de Java:', error);
        return false;
    }
}

// Fonction pour télécharger et installer Java
async function downloadAndInstallJava(event) {
    try {
        // Vérifier si l'installateur existe localement
        const javaLocalExists = await fs.pathExists(JAVA_LOCAL_PATH);
        let installerPath;

        if (javaLocalExists) {
            console.log('Installateur Java 21 trouvé localement à:', JAVA_LOCAL_PATH);
            event.sender.send('install-progress', { stage: 'using-local-java', message: 'Utilisation de l\'installateur Java 21 local...' });
            // Copier l'installateur local vers le répertoire temp
            await fs.copy(JAVA_LOCAL_PATH, JAVA_INSTALLER_PATH);
            installerPath = JAVA_INSTALLER_PATH;
        } else {
            console.log('Téléchargement de l\'installateur Java 21 depuis:', JAVA_DOWNLOAD_URL);
            event.sender.send('install-progress', { stage: 'downloading-java', message: 'Téléchargement de Java 21...' });
            
            // Téléchargement de Java
            const writer = fs.createWriteStream(JAVA_INSTALLER_PATH);
            const response = await axios({
                url: JAVA_DOWNLOAD_URL,
                method: 'GET',
                responseType: 'stream'
            });

            await new Promise((resolve, reject) => {
                response.data.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            installerPath = JAVA_INSTALLER_PATH;
            
            // Sauvegarder une copie dans le dossier download
            try {
                await fs.ensureDir(path.dirname(JAVA_LOCAL_PATH));
                await fs.copy(JAVA_INSTALLER_PATH, JAVA_LOCAL_PATH);
                console.log('Installateur Java 21 sauvegardé dans:', JAVA_LOCAL_PATH);
            } catch (copyError) {
                console.error('Erreur lors de la sauvegarde de l\'installateur Java:', copyError);
                // On continue même si la sauvegarde échoue
            }
        }

        event.sender.send('install-progress', { stage: 'installing-java', message: 'Installation de Java 21...' });

        // Installation silencieuse de Java avec affichage de la progression
        await new Promise((resolve, reject) => {
            const child = exec(`"${installerPath}" /s`, { windowsHide: true });
            child.on('close', (code) => {
                if (code === 0) {
                    console.log('Installation de Java 21 réussie');
                    resolve();
                } else {
                    console.error(`L'installation de Java 21 a échoué avec le code ${code}`);
                    reject(new Error(`L'installation de Java 21 a échoué avec le code ${code}`));
                }
            });
        });

        // Mise à jour du chemin Java dans le store
        store.set('java.path', 'C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe');
        return true;
    } catch (error) {
        console.error('Erreur lors de l\'installation de Java 21:', error);
        throw error;
    }
}

// Fonction pour copier le launcher_profiles.json
async function copyLauncherProfiles() {
    try {
        const minecraftPath = path.join(os.homedir(), 'AppData', 'Roaming', '.minecraft');
        const sourcePath = path.join(minecraftPath, 'launcher_profiles.json');
        const destPath = path.join(GAME_PATH, 'launcher_profiles.json');

        // S'assurer que le dossier de destination existe
        await fs.ensureDir(GAME_PATH);

        // Vérifier si le fichier source existe
        if (await fs.pathExists(sourcePath)) {
            // Vérifier si le fichier de destination n'existe pas déjà ou s'il est plus ancien
            const copyFile = async () => {
                await fs.copy(sourcePath, destPath, { overwrite: true });
                console.log('launcher_profiles.json copié avec succès');
            };

            if (!await fs.pathExists(destPath)) {
                await copyFile();
            } else {
                // Comparer les dates de modification
                const sourceStats = await fs.stat(sourcePath);
                const destStats = await fs.stat(destPath);
                
                if (sourceStats.mtime > destStats.mtime) {
                    await copyFile();
                } else {
                    console.log('launcher_profiles.json est à jour dans la destination');
                }
            }
        } else {
            console.log('launcher_profiles.json non trouvé dans .minecraft');
            
            // Si le fichier source n'existe pas, création d'un fichier minimal
            if (!await fs.pathExists(destPath)) {
                const minimalProfiles = {
                    "profiles": {},
                    "settings": {
                        "crashAssistance": true,
                        "enableSnapshots": false,
                        "keepLauncherOpen": false,
                        "showMenu": false
                    },
                    "version": 3
                };
                
                await fs.writeJson(destPath, minimalProfiles, { spaces: 2 });
                console.log('Un launcher_profiles.json minimal a été créé');
            }
        }
    } catch (error) {
        console.error('Erreur lors de la copie de launcher_profiles.json:', error);
    }
}

// Fonction pour configurer le serveur par défaut
async function setupDefaultServer() {
    try {
        // Chercher le fichier servers.dat dans tous les emplacements possibles (comme resources.json)
        const possibleLocations = [
            // Application resources
            path.join(process.resourcesPath, 'servers.dat'),
            path.join(process.resourcesPath, 'Resources', 'servers.dat'),
            // Application root
            path.join(app.getAppPath(), 'servers.dat'),
            path.join(app.getPath('exe'), '..', 'servers.dat'),
            // Application directory
            path.join(app.getAppPath(), 'src', 'servers.dat'),
            path.join(__dirname, '..', 'servers.dat'),
            path.join(__dirname, 'servers.dat'),
            // User data
            path.join(app.getPath('userData'), 'servers.dat'),
            // Minecraft original (fallback)
            path.join(app.getPath('appData'), '.minecraft', 'servers.dat')
        ];
        
        console.log('Configuration du serveur par défaut...');
        console.log('Searching for servers.dat in these locations:');
        possibleLocations.forEach(loc => console.log(' - ' + loc));
        
        let sourcePath = null;
        // Check all possible locations
        for (const location of possibleLocations) {
            try {
                if (await fs.pathExists(location)) {
                    console.log('Found servers.dat at:', location);
                    sourcePath = location;
                    break;
                }
            } catch (error) {
                console.log('Error checking', location, error.message);
            }
        }
        
        // Si aucun fichier n'est trouvé, on pourrait créer un fichier de base 
        // (mais pour l'instant, on renvoie juste une erreur)
        if (!sourcePath) {
            console.error('Erreur: Impossible de trouver un fichier servers.dat valide');
            return false;
        }
        
        const destPath = path.join(GAME_PATH, 'servers.dat');
        
        // S'assurer que le répertoire cible existe
        await fs.ensureDir(GAME_PATH);
        
        // Supprimer le fichier existant s'il y en a un
        if (await fs.pathExists(destPath)) {
            await fs.remove(destPath);
            console.log('Ancien fichier servers.dat supprimé');
        }
        
        // Copier le fichier source vers .elysia
        console.log(`Copie du fichier servers.dat depuis ${sourcePath} vers .elysia...`);
        await fs.copy(sourcePath, destPath);
        console.log('Fichier servers.dat copié avec succès');
        
        return true;
    } catch (error) {
        console.error('Erreur lors de la configuration du serveur par défaut:', error);
        console.error(error.stack);
        return false;
    }
}

// Modification du handler d'installation pour ajouter la configuration du serveur
ipcMain.handle('install-game', async (event) => {
    try {
        // Initialisation des variables de progression
        let progress = 0;
        let totalProgress = 2; // Nombre d'étapes dans l'installation

        // Vérifier l'installation de vanilla Minecraft
        const minecraftValid = await verifyMinecraftInstallation();
        if (!minecraftValid) {
            event.sender.send('install-progress', { stage: 'installing-vanilla', message: 'Installation de Minecraft...' });
            await installVanilla(event);
        } else {
            console.log('Minecraft is already installed, skipping reinstallation.');
        }

        // Vérifier l'installation de Fabric
        const fabricValid = await verifyFabricInstallation();
        
        if (!fabricValid) {
            event.sender.send('install-progress', { stage: 'installing-fabric', message: 'Installation de Fabric...' });
            
            // S'assurer que le fichier n'existe pas déjà (corrompu)
            if (await fs.pathExists(FABRIC_INSTALLER_PATH)) {
                await fs.remove(FABRIC_INSTALLER_PATH);
                console.log('Fichier Fabric existant supprimé avant téléchargement');
            }
            
            try {
                await downloadFabric(event);
                const success = await installFabric(event);
                if (!success) {
                    console.warn('Installation de Fabric échouée, mais poursuite de l\'installation');
                    event.sender.send('install-progress', { 
                        stage: 'fabric-failed', 
                        message: 'Installation de Fabric échouée - continuation sans Fabric' 
                    });
                }
            } catch (fabricError) {
                console.error('Erreur pendant l\'installation de Fabric:', fabricError);
                event.sender.send('install-progress', { 
                    stage: 'fabric-failed', 
                    message: `Échec de l'installation de Fabric - continuation sans` 
                });
            }
        } else {
            console.log('Fabric is already installed, skipping reinstallation.');
        }

        // Vérifier l'installation des mods
        const modsValid = await verifyModsInstallation();
        if (!modsValid) {
            event.sender.send('install-progress', { 
                stage: 'installing-mods', 
                message: 'Installation des mods nécessaires...' 
            });
            await installMods(event);
        } else {
            console.log('Mods are already installed and up to date, skipping reinstallation.');
            // Notification à l'utilisateur que les mods sont déjà installés
            event.sender.send('install-progress', { 
                stage: 'mods-validated', 
                message: 'Mods déjà installés, vérification terminée' 
            });
        }

        // Vérifier et installer les ressources
        const resourcesValid = await resourceManager.verifyResources();
        if (!resourcesValid) {
            event.sender.send('install-progress', {
                stage: 'installing-resources',
                message: 'Installation des ressources...'
            });
            await installResources(event);
        } else {
            console.log('Resources are already installed, skipping reinstallation.');
            // Notification à l'utilisateur que les ressources sont déjà installées
            event.sender.send('install-progress', { 
                stage: 'resources-validated', 
                message: 'Ressources déjà installées, vérification terminée' 
            });
        }
        
        // Configurer le serveur par défaut
        event.sender.send('install-progress', {
            stage: 'configuring-server',
            message: 'Configuration du serveur par défaut...'
        });
        console.log('Tentative de configuration du serveur par défaut...');
        try {
            const serverSetupResult = await setupDefaultServer();
            console.log('Résultat de la configuration du serveur:', serverSetupResult ? 'Succès' : 'Échec');
        } catch (serverError) {
            console.error('Erreur critique lors de la configuration du serveur:', serverError);
        }

        gameInstalled = true;
        store.set('gameInstalled', true);
        return { success: true, message: 'Installation terminée avec succès.' };
    } catch (error) {
        console.error('Erreur lors de l\'installation:', error);
        return { success: false, message: error.message };
    }
});

// Fonction pour vérifier l'installation de Minecraft
async function verifyMinecraftInstallation() {
    try {
        const minecraftPath = path.join(GAME_PATH, 'versions', '1.21.1');
        const requiredFiles = [
            path.join(minecraftPath, '1.21.1.json'),
            path.join(minecraftPath, '1.21.1.jar')
        ];

        for (const file of requiredFiles) {
            if (!await fs.pathExists(file)) {
                console.log(`Fichier Minecraft manquant: ${file}`);
                return false;
            }
        }
        return true;
    } catch (error) {
        console.error('Erreur lors de la vérification de Minecraft:', error);
        return false;
    }
}

// Fonction pour vérifier l'installation de Fabric
async function verifyFabricInstallation() {
    try {
        const fabricVersionPath = path.join(GAME_PATH, 'versions', FABRIC_VERSION_LAUNCHER);
        const fabricLibPath = path.join(GAME_PATH, 'libraries', 'net', 'fabricmc', 'fabric-loader', FABRIC_VERSION);
        
        console.log('Vérification des chemins Fabric:');
        console.log('Version Path:', fabricVersionPath);
        console.log('Lib Path:', fabricLibPath);

        const requiredFiles = [
            path.join(fabricVersionPath, `${FABRIC_VERSION_LAUNCHER}.json`),
            path.join(fabricLibPath, `fabric-loader-${FABRIC_VERSION}.jar`)
        ];

        for (const file of requiredFiles) {
            console.log('Vérification du fichier:', file);
            if (!await fs.pathExists(file)) {
                console.log(`Fichier Fabric manquant: ${file}`);
                return false;
            }
            
            const stats = await fs.stat(file);
            console.log(`Taille du fichier ${path.basename(file)}: ${stats.size} bytes`);
            if (stats.size === 0) {
                console.log(`Fichier Fabric corrompu (taille 0): ${file}`);
                return false;
            }
        }

        return true;
    } catch (error) {
        console.error('Erreur lors de la vérification de Fabric:', error);
        return false;
    }
}

// Ajouter cette nouvelle fonction
async function renameFabricJson() {
    try {
        const fabricVersionPath = path.join(GAME_PATH, 'versions', FABRIC_VERSION_LAUNCHER);
        const currentJsonPath = path.join(fabricVersionPath, '1.21.1.json');
        const newJsonPath = path.join(fabricVersionPath, `${FABRIC_VERSION_LAUNCHER}.json`);

        // Vérifier si le fichier source existe
        if (await fs.pathExists(currentJsonPath)) {
            // Vérifier si le fichier de destination n'existe pas déjà
            if (!await fs.pathExists(newJsonPath)) {
                await fs.copy(currentJsonPath, newJsonPath);
                console.log('Fichier JSON Fabric renommé avec succès');
            }
        }
    } catch (error) {
        console.error('Erreur lors du renommage du fichier JSON Fabric:', error);
    }
}

// Fonction pour formater le temps
function formatPlayTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

// Fonction pour démarrer le suivi du temps de jeu
function startPlayTimeTracking() {
    // Charger le temps de jeu existant
    currentPlayTime = store.get('playTime', 0);
    
    // Enregistrer l'heure de démarrage
    gameStartTime = Date.now();
    
    // Incrémenter le compteur de sessions
    const sessionCount = store.get('session-count', 0) + 1;
    store.set('session-count', sessionCount);
    
    // Enregistrer la date et l'heure de la session
    const now = new Date();
    const formattedDate = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    store.set('last-session-date', formattedDate);
    
    // Créer un intervalle pour mettre à jour le temps de jeu toutes les 30 secondes
    playTimeTracker = setInterval(() => {
        if (gameRunning && gameStartTime) {
            // Calculer le temps écoulé depuis le début de la session
            const elapsedSeconds = Math.floor((Date.now() - gameStartTime) / 1000);
            
            // Mettre à jour le temps de jeu total
            const updatedPlayTime = currentPlayTime + elapsedSeconds;
            
            // Enregistrer le temps dans le stockage
            store.set('playTime', updatedPlayTime);
            
            // Envoyer la mise à jour à l'interface utilisateur
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('play-time-update', {
                    playTime: updatedPlayTime,
                    sessionTime: elapsedSeconds,
                    formattedTime: formatPlayTime(updatedPlayTime)
                });
            }
        }
    }, 30000); // Mise à jour toutes les 30 secondes
}

// Fonction pour arrêter le suivi du temps de jeu
function stopPlayTimeTracking() {
    // Nettoyer l'intervalle
    if (playTimeTracker) {
        clearInterval(playTimeTracker);
        playTimeTracker = null;
    }
    
    // Si le jeu était en cours d'exécution, enregistrer le temps final
    if (gameRunning && gameStartTime) {
        const elapsedSeconds = Math.floor((Date.now() - gameStartTime) / 1000);
        const finalPlayTime = currentPlayTime + elapsedSeconds;
        
        // Enregistrer le temps dans le stockage
        store.set('playTime', finalPlayTime);
        
        // Vérifier si c'est la session la plus longue
        const longestSession = store.get('longest-session', 0);
        if (elapsedSeconds > longestSession) {
            store.set('longest-session', elapsedSeconds);
        }
        
        // Réinitialiser les variables
        gameStartTime = null;
        currentPlayTime = finalPlayTime;
        
        // Envoyer la mise à jour finale à l'interface utilisateur
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('play-time-update', {
                playTime: finalPlayTime,
                sessionTime: elapsedSeconds,
                formattedTime: formatPlayTime(finalPlayTime)
            });
        }
    }
}

// Modification de la fonction launchMinecraft pour suivre la documentation
async function launchMinecraft(event, options) {
    try {
        // Vérifier et rafraîchir le token si nécessaire
        let token = store.get('minecraft-token');
        if (!token) {
            // Tenter de rafraîchir le token
            const refreshed = await refreshMinecraftToken();
            if (refreshed) {
                token = store.get('minecraft-token');
            } else {
                throw new Error('Veuillez vous connecter avec votre compte Microsoft');
            }
        }

        // Vérifier la présence de launcher_profiles.json
        const profilePath = path.join(GAME_PATH, 'launcher_profiles.json');
        if (!await fs.pathExists(profilePath)) {
            console.log('launcher_profiles.json manquant avant le lancement, tentative de copie...');
            await copyLauncherProfiles();
        }

        await renameFabricJson();

        // Récupérer la valeur RAM sauvegardée ou utiliser celle des options
        const memorySetting = options.memory || store.get('memory-setting', 4);
        
        const opts = {
            clientPackage: null,
            authorization: token,
            root: GAME_PATH,
            version: {
                number: '1.21.1',
                type: "release",
                custom: FABRIC_VERSION_LAUNCHER
            },
            javaPath: javaPath,
            memory: {
                max: `${memorySetting}G`,
                min: "1G"
            },
            window: {
                width: 1280,
                height: 720,
                fullscreen: false
            },
            // Ajout des options de diagnostic et de logging
            overrides: {
                detached: false,
                stdio: 'pipe'
            },
            // Ajout des options de logging
            logging: true
        };

        // Ajouter un log pour déboguer
        console.log('Options de lancement:', JSON.stringify(opts, null, 2));

        const launcher = new Client();

        // Gestion des événements selon la documentation
        launcher.on('debug', (e) => {
            const logPath = path.join(GAME_PATH, 'launcher.log');
            fs.appendFileSync(logPath, `${new Date().toISOString()} - DEBUG: ${e}\n`);
            console.log('Debug:', e);
        });

        launcher.on('data', (e) => {
            const logPath = path.join(GAME_PATH, 'minecraft.log');
            fs.appendFileSync(logPath, `${new Date().toISOString()} - ${e}\n`);
            console.log('Minecraft:', e);
        });

        launcher.on('progress', (e) => {
            if (e.type === 'download') {
                const progressPercent = Math.round((e.task / e.total) * 100);
                event.sender.send('download-progress', progressPercent);
            }
        });

        launcher.on('close', async (code) => {
            console.log('Minecraft closed with code:', code);
            gameRunning = false;
            event.sender.send('game-closed', code);
        });

        // Ajouter un gestionnaire pour la fermeture du launcher
        mainWindow.on('close', async () => {
            if (gameRunning) {
                await killMinecraftProcess();
                gameRunning = false;
            }
        });

        // Stocker le processus Minecraft dans la variable globale
        launcher.on('start', (proc) => {
            gameProcess = proc;
        });

        // Étape de pré-lancement
        event.sender.send('install-progress', {
            stage: 'launching',
            progress: 90,
            message: 'Préparation du contexte de jeu...'
        });

        // Initialiser et exécuter l'anti-cheat
        if (SERVER_NAME) {
            // ANTI-CHEAT DÉSACTIVÉ
            /*
            antiCheat.initialize(SERVER_NAME);
            
            // Analyse anti-cheat avant le lancement
            event.sender.send('install-progress', {
                stage: 'security',
                progress: 92,
                message: 'Vérification de sécurité...'
            });
            
            const scanResults = await antiCheat.runFullScan();
            
            // Si des triches sont détectées, on le notifie à l'utilisateur et on continue quand même
            if (scanResults.detectionFound) {
                console.warn('Anti-cheat: détection de modifications potentiellement non autorisées');
                event.sender.send('install-progress', {
                    stage: 'warning',
                    progress: 95,
                    message: 'Avertissement: Certaines modifications non autorisées ont été détectées.'
                });
                
                // On laisse un délai pour que l'utilisateur puisse voir le message
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            */
        }

        // Ajouter un délai visuel pour la transition
        await new Promise(resolve => setTimeout(resolve, 500));

        // Émettre l'événement de pré-lancement
        event.sender.send('pre-launch');

        // Lancement du jeu
        await launcher.launch(opts);
        
        gameRunning = true;
        // Démarrer le suivi du temps de jeu
        startPlayTimeTracking();
        mainWindow.minimize();
        
        // Mettre à jour Discord Rich Presence
        discordRPC.setPlaying({
            serverName: SERVER_NAME,
            gameVersion: '1.21.1'
        });

        // Configurer le scan périodique de l'anti-cheat si activé
        let antiCheatInterval = null;

        if (SERVER_NAME) {
            // ANTI-CHEAT DÉSACTIVÉ
            /*
            // Exécuter un scan toutes les 5 minutes pendant le jeu
            antiCheatInterval = setInterval(async () => {
                if (gameRunning) {
                    console.log('Exécution du scan anti-cheat périodique');
                    const scanResults = await antiCheat.runFullScan();
                    
                    if (scanResults.detectionFound) {
                        console.warn('Anti-cheat: détection périodique de modifications non autorisées');
                    }
                } else {
                    // Arrêter le scan si le jeu n'est plus en cours d'exécution
                    if (antiCheatInterval) {
                        clearInterval(antiCheatInterval);
                        antiCheatInterval = null;
                    }
                }
            }, 5 * 60 * 1000); // 5 minutes
            */
        }

        // Envoyer la confirmation de démarrage
        event.sender.send('game-started');

        // Nettoyer l'intervalle lorsque le jeu se termine
        launcher.on('close', () => {
            // Arrêter le suivi du temps de jeu
            stopPlayTimeTracking();
            
            // Remettre à jour le statut Discord Rich Presence
            discordRPC.setInLauncher();
            
            if (antiCheatInterval) {
                clearInterval(antiCheatInterval);
                antiCheatInterval = null;
            }
        });

        return { success: true };
    } catch (error) {
        console.error('Erreur lors du lancement de Minecraft:', error);
        return { success: false, error: error.message };
    }
}

ipcMain.handle('check-game-installation', async () => {
    const storedGameInstalled = store.get('gameInstalled', false);

    if (storedGameInstalled) {
        gameInstalled = true;
        return { installed: true };
    }

    try {
        await fs.access(path.join(GAME_PATH, '.fabric'));
        gameInstalled = true;
        store.set('gameInstalled', true);
        return { installed: true };
    } catch (error) {
        gameInstalled = false;
        store.set('gameInstalled', false);
        return { installed: false };
    }
});

// Modifier le handler launch-game pour gérer les échecs de Fabric
ipcMain.handle('launch-game', async (event, options) => {
    try {
        // Vérifier l'authentification en premier
        const savedToken = store.get('minecraft-token');
        if (!savedToken) {
            return {
                success: false,
                error: 'Veuillez vous connecter avec votre compte Microsoft'
            };
        }

        // Afficher un message de démarrage
        event.sender.send('install-progress', {
            stage: 'starting',
            message: 'Préparation du lancement...'
        });

        // Copier launcher_profiles.json avant toute opération
        await copyLauncherProfiles();

        gameStartTime = Date.now();
        
        // Vérifier et créer les dossiers avant toute opération
        await resourceManager.initialize();

        // Vérifier les installations
        const minecraftValid = await verifyMinecraftInstallation();
        if (!minecraftValid) {
            event.sender.send('install-progress', {
                stage: 'installing-minecraft',
                message: 'Installation de Minecraft nécessaire...'
            });
            await installVanilla(event);
        }

        // Vérifier l'installation de Fabric
        const fabricValid = await verifyFabricInstallation();
        if (!fabricValid) {
            event.sender.send('install-progress', {
                stage: 'installing-fabric',
                message: 'Tentative d\'installation de Fabric...'
            });
            
            // Tentative d'installation qui peut échouer sans bloquer
            const fabricInstalled = await installFabric(event);
            
            if (!fabricInstalled) {
                console.warn('Échec de l\'installation de Fabric - continuation sans');
                event.sender.send('install-progress', {
                    stage: 'warning',
                    message: 'Fabric non installé - certaines fonctionnalités peuvent être limitées'
                });
            }
        }

        // Vérifier l'installation des mods
        try {
            const modsValid = await verifyModsInstallation();
            if (!modsValid) {
                const missingMods = store.get('missing-mods', []);
                const missingCount = missingMods.length;
                
                event.sender.send('install-progress', {
                    stage: 'installing-mods',
                    message: `Installation de ${missingCount} mods manquants...`
                });
                
                await installMods(event);
            }
        } catch (modsError) {
            console.error('Erreur lors de la vérification des mods:', modsError);
            event.sender.send('install-progress', {
                stage: 'warning',
                message: 'Problème avec la vérification des mods - tentative de continuation'
            });
        }

        // Vérifier les ressources (resource packs et shaders)
        try {
            const resourcesValid = await resourceManager.verifyResources();
            if (!resourcesValid) {
                event.sender.send('install-progress', {
                    stage: 'installing-resources',
                    message: 'Création des dossiers et installation des ressources...'
                });
                await installResources(event);
            }
        } catch (resourcesError) {
            console.error('Erreur lors de la vérification des ressources:', resourcesError);
            event.sender.send('install-progress', {
                stage: 'warning',
                message: 'Problème avec les ressources - tentative de continuation'
            });
        }

        // Configurer le serveur par défaut
        event.sender.send('install-progress', {
            stage: 'configuring-server',
            message: 'Configuration du serveur par défaut...'
        });
        
        try {
            const serverSetupResult = await setupDefaultServer();
            console.log('Résultat de la configuration du serveur:', serverSetupResult ? 'Succès' : 'Échec');
        } catch (serverError) {
            console.error('Erreur lors de la configuration du serveur:', serverError);
            event.sender.send('install-progress', {
                stage: 'warning',
                message: 'Problème avec la configuration du serveur - tentative de continuation'
            });
        }

        // Lancer le jeu
        event.sender.send('install-progress', {
            stage: 'launching',
            message: 'Lancement de Minecraft...'
        });
        
        const launchResult = await launchMinecraft(event, options);
        return {
            success: true,
            ...launchResult
        };
    } catch (error) {
        console.error('Erreur lors du lancement:', error);
        event.sender.send('install-progress', {
            stage: 'error',
            message: `Erreur: ${error.message}`
        });
        return {
            success: false,
            error: error.message
        };
    }
});

async function loadConfigurations() {
    // Créer les dossiers nécessaires
    await resourceManager.initialize();
    
    // Copier launcher_profiles.json
    await copyLauncherProfiles();
    
    // Chargement des configurations
    const configs = {
        'java-path': javaPath,
        'game-directory': GAME_PATH,
        'fabric-version': FABRIC_VERSION,
        'minecraft-version': '1.21.1'
    };

    Object.entries(configs).forEach(([key, value]) => {
        if (!store.has(key)) {
            store.set(key, value);
        }
    });
}

// Modification de la fonction pour tuer le processus Minecraft
async function killMinecraftProcess() {
    // Arrêter le suivi du temps de jeu
    stopPlayTimeTracking();
    
    if (process.platform === 'win32') {
        try {
            // Sur Windows, on utilise taskkill pour forcer la fermeture du processus Java
            await new Promise((resolve, reject) => {
                exec('taskkill /F /IM java.exe', (error, stdout, stderr) => {
                    if (error) {
                        console.log('Aucun processus Java en cours');
                        resolve();
                    } else {
                        console.log('Processus Java terminé');
                        resolve();
                    }
                });
            });
        } catch (error) {
            console.error('Erreur lors de la fermeture du processus Java:', error);
        }
    }
}

async function calculateFileHashFromUrl(url) {
    try {
        const response = await axios.head(url);
        return response.headers['x-checksum-sha256'] || null;
    } catch (error) {
        console.error('Erreur récupération hash:', error);
        return null;
    }
}

// Handler pour récupérer les stats
ipcMain.handle('get-game-stats', () => {
    // Si le jeu est en cours, calculer le temps en temps réel
    let playTime = store.get('playTime', 0);
    
    if (gameRunning && gameStartTime) {
        const elapsedSeconds = Math.floor((Date.now() - gameStartTime) / 1000);
        playTime = currentPlayTime + elapsedSeconds;
    }
    
    // Récupérer les statistiques enregistrées
    const sessionCount = store.get('session-count', 0);
    const lastSessionDate = store.get('last-session-date', null);
    const longestSession = store.get('longest-session', 0);
    
    return {
        playTime: playTime,
        sessionCount: sessionCount,
        lastSessionDate: lastSessionDate,
        longestSession: longestSession,
        version: app.getVersion() || '2.0.5'
    };
});

// Ajouter cette nouvelle fonction pour vérifier l'état de l'authentification
ipcMain.handle('check-auth', () => {
    const token = store.get('minecraft-token');
    const profile = store.get('minecraft-profile');
    
    return {
        isAuthenticated: !!token,
        profile: profile || null
    };
});

// Fonction pour supprimer complètement les fichiers du launcher
async function uninstallLauncher() {
    try {
        console.log('Demande de désinstallation reçue');
        if (mainWindow) {
            mainWindow.webContents.send('uninstall-progress', { 
                stage: 'preparing', 
                message: 'Préparation de la désinstallation...' 
            });
        }
        
        const pathsToClean = [
            path.join(app.getPath('appData'), '.elysia'), // Dossier principal du jeu
            path.join(app.getPath('userData')), // Dossier de configuration du launcher
            path.join(app.getPath('temp'), 'fabric-installer-1.0.1.jar'), // Installateur Fabric
            path.join(app.getPath('temp'), 'jdk-21-installer.exe'), // Installateur Java
            path.join(app.getPath('temp'), 'index.html'), // Fichiers temporaires
            path.join(app.getPath('temp'), 'splash.html') // Fichiers temporaires
        ];

        // Informer l'utilisateur
        if (mainWindow) {
            mainWindow.webContents.send('uninstall-progress', { 
                stage: 'removing', 
                message: 'Suppression des fichiers...' 
            });
        }

        for (const pathToClean of pathsToClean) {
            if (fs.existsSync(pathToClean)) {
                if (mainWindow) {
                    mainWindow.webContents.send('uninstall-progress', { 
                        stage: 'removing', 
                        message: `Suppression de ${pathToClean}...` 
                    });
                }
                
                // Vérifier si c'est un dossier ou un fichier
                const stats = fs.statSync(pathToClean);
                if (stats.isDirectory()) {
                    await fs.remove(pathToClean);
                } else {
                    await fs.unlink(pathToClean);
                }
            }
        }

        if (mainWindow) {
            mainWindow.webContents.send('uninstall-progress', { 
                stage: 'complete', 
                message: 'Désinstallation terminée.' 
            });
        }

        return true;
    } catch (error) {
        console.error('Erreur lors de la désinstallation:', error);
        if (mainWindow) {
            mainWindow.webContents.send('uninstall-progress', { 
                stage: 'error', 
                message: `Erreur lors de la désinstallation: ${error.message}` 
            });
        }
        return false;
    }
}

// Fonction pour exécuter le désinstallateur NSIS
function runNsisUninstaller() {
    try {
        // D'abord, supprimez le dossier .elysia
        if (fs.existsSync(GAME_PATH)) {
            console.log(`Suppression du dossier .elysia complet: ${GAME_PATH}`);
            fs.removeSync(GAME_PATH);
        }
        
        // Chercher le désinstallateur dans le dossier habituel d'installation
        const appDataPath = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Elysia');
        const uninstallerPath = path.join(appDataPath, 'Uninstall Elysia.exe');
        
        // Vérifier d'abord le chemin dans AppData
        if (fs.existsSync(uninstallerPath)) {
            // Démarrer le désinstallateur
            require('child_process').spawn(uninstallerPath, [], {
                detached: true,
                stdio: 'ignore'
            }).unref();
            
            // Fermer l'application
            app.quit();
            return true;
        } 
        
        // Chemin de secours si le désinstallateur n'est pas trouvé dans AppData
        const exeName = path.basename(process.execPath);
        const installLocation = path.dirname(process.execPath);
        const fallbackUninstallerPath = path.join(installLocation, 'Uninstall ' + exeName);
        
        if (fs.existsSync(fallbackUninstallerPath)) {
            // Démarrer le désinstallateur
            require('child_process').spawn(fallbackUninstallerPath, [], {
                detached: true,
                stdio: 'ignore'
            }).unref();
            
            // Fermer l'application
            app.quit();
            return true;
        } else {
            console.error('Désinstallateur introuvable:', uninstallerPath, 'et', fallbackUninstallerPath);
            return false;
        }
    } catch (error) {
        console.error('Erreur lors du lancement du désinstallateur:', error);
        return false;
    }
}

// Ajouter un gestionnaire d'événement IPC pour la désinstallation
ipcMain.handle('uninstall-launcher', async () => {
    const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: 'Désinstallation d\'Elysia',
        message: 'Êtes-vous sûr de vouloir désinstaller complètement Elysia et tous ses fichiers? Cette action est irréversible.',
        buttons: ['Annuler', 'Désinstaller'],
        defaultId: 0,
        cancelId: 0
    });

    if (response === 1) {
        // Exécuter le désinstallateur NSIS au lieu de la fonction manuelle
        return runNsisUninstaller();
    }
    return false;
});

// Écouteur pour vider le cache
ipcMain.handle('clear-cache', async () => {
    try {
        console.log("Demande de nettoyage complet du cache et du dossier .elysia");
        const success = await clearLauncherCache();
        console.log(`Résultat du nettoyage: ${success ? 'Succès' : 'Échec'}`);
        return { success };
    } catch (error) {
        console.error('Erreur lors du vidage du cache:', error);
        return { success: false, error: error.message };
    }
});

// Fonction pour trouver le chemin valide de resources.json
async function findResourcesJsonPath() {
    // Chercher le fichier resources.json dans tous les emplacements possibles
    const possibleLocations = [
        // Application resources
        path.join(process.resourcesPath, 'resources.json'),
        path.join(process.resourcesPath, 'Resources', 'resources.json'),
        // Application root
        path.join(app.getAppPath(), 'resources.json'),
        path.join(app.getPath('exe'), '..', 'resources.json'),
        // Application directory
        path.join(app.getAppPath(), 'src', 'resources.json'),
        path.join(__dirname, 'resources.json'),
        // User data
        path.join(app.getPath('userData'), 'resources.json')
    ];
    
    // Log for debugging
    console.log('Searching for resources.json in these locations:');
    possibleLocations.forEach(loc => console.log(' - ' + loc));
    
    // Check all possible locations
    for (const location of possibleLocations) {
        try {
            if (await fs.pathExists(location)) {
                console.log('Found resources.json at:', location);
                return location;
            }
        } catch (error) {
            console.log('Error checking', location, error.message);
        }
    }
    
    // If not found, try to create it
    try {
        // Last resort: copy from __dirname if it exists
        const defaultPath = path.join(__dirname, 'resources.json');
        if (await fs.pathExists(defaultPath)) {
            const defaultContent = await fs.readFile(defaultPath, 'utf-8');
            const fallbackDirectory = app.getPath('userData');
            const fallbackPath = path.join(fallbackDirectory, 'resources.json');
            await fs.writeFile(fallbackPath, defaultContent);
            console.log('resources.json recreated in fallback location:', fallbackPath);
            return fallbackPath;
        }
    } catch (error) {
        console.error('Failed to recreate resources.json:', error);
    }
    
    // If we get here, no valid resources.json was found
    throw new Error("resources.json file not found in any location");
}

// Fonction pour installer les ressources (resource packs et shaders)
async function installResources(event) {
    try {
        // Recréer les dossiers au cas où
        await resourceManager.initialize();
        
        // Récupérer le chemin du fichier resources.json
        const resourcesJsonPath = await findResourcesJsonPath();
        
        // Charger et installer les ressources depuis la configuration
        const resourcesConfig = JSON.parse(await fs.readFile(resourcesJsonPath, 'utf8'));
        
        // Installation des resource packs
        for (const pack of resourcesConfig.resourcepacks || []) {

            await resourceManager.installResourcePack(pack.url, event);
        }
        
        // Installation des shaders
        for (const shader of resourcesConfig.shaders || []) {

            await resourceManager.installShader(shader.url, event);
        }
        
        return true;
    } catch (error) {
        console.error('Erreur lors de l\'installation des ressources:', error);
        throw error;
    }
}

// Ajouter des gestionnaires IPC pour les actualités et mises à jour
ipcMain.handle('fetch-discord-news', async () => {
    try {
        const news = await discordNewsManager.fetchNews();
        return { success: true, news };
    } catch (error) {
        console.error('Erreur lors de la récupération des actualités:', error);
        return { 
            success: false, 
            error: error.message,
            news: [
                {
                    id: 'error',
                    title: 'Erreur de connexion',
                    content: 'Impossible de récupérer les actualités. Veuillez vérifier votre connexion internet et réessayer.',
                    author: 'Système',
                    timestamp: new Date().toISOString()
                }
            ]
        };
    }
});

ipcMain.handle('fetch-updates', async () => {
    try {
        // Essayer d'abord de charger les mises à jour locales
        await updatesManager.loadLocalUpdates();
        let updates = updatesManager.getUpdates();
        
        // Si pas de mises à jour locales ou si on veut les dernières, récupérer à distance
        if (updates.length === 0) {
            console.log('Tentative de récupération des mises à jour via GitHub Releases API...');
            try {
                updates = await updatesManager.fetchRemoteUpdates();
                console.log(`${updates.length} mises à jour récupérées depuis GitHub`);
            } catch (remoteError) {
                console.error('Erreur lors de la récupération distante:', remoteError);
                
                // En cas d'échec, utiliser des mises à jour par défaut
                if (updates.length === 0) {
                    updates = [
                        {
                            id: '0',
                            version: app.getVersion() || '2.0.5',
                            date: new Date().toISOString(),
                            title: 'Launcher Elysia',
                            description: 'Bienvenue dans le Launcher Elysia. Consultez les releases sur GitHub pour plus d\'informations sur les mises à jour.',
                            content: 'Bienvenue dans le Launcher Elysia.<br><br>Consultez les releases sur GitHub pour plus d\'informations sur les mises à jour.',
                            changes: ['Launcher initialisé']
                        }
                    ];
                }
            }
        }
        
        // Stocker dans electron-store
        store.set('updates', updates);
        
        return { success: true, updates };
    } catch (error) {
        console.error('Erreur lors de la récupération des mises à jour:', error);
        
        // Même en cas d'erreur globale, renvoyer une information par défaut
        const defaultUpdates = [
            {
                id: '0',
                version: app.getVersion() || '2.0.5',
                date: new Date().toISOString(),
                title: 'Information',
                description: 'Impossible de récupérer les mises à jour. Vérifiez votre connexion Internet.',
                content: 'Impossible de récupérer les mises à jour.<br><br>Vérifiez votre connexion Internet.',
                changes: ['Launcher disponible']
            }
        ];
        
        return { success: true, updates: defaultUpdates };
    }
});

// Fonction pour vider le cache du launcher
async function clearLauncherCache() {
    try {
        const cachePaths = [
            path.join(GAME_PATH, 'cache'),
            path.join(app.getPath('userData'), 'Cache'),
            path.join(app.getPath('userData'), 'Code Cache'),
            path.join(app.getPath('temp'), '.elysia-temp')
        ];

        for (const cachePath of cachePaths) {
            if (fs.existsSync(cachePath)) {
                await fs.remove(cachePath);
                console.log(`Cache supprimé: ${cachePath}`);
            }
        }

        // Suppression complète du dossier .elysia
        if (fs.existsSync(GAME_PATH)) {
            console.log(`Suppression du dossier .elysia: ${GAME_PATH}`);
            await fs.remove(GAME_PATH);
            
            // Recréer la structure des dossiers de base
            await fs.ensureDir(GAME_PATH);
            await fs.ensureDir(path.join(GAME_PATH, 'mods'));
            await fs.ensureDir(path.join(GAME_PATH, 'resourcepacks'));
            await fs.ensureDir(path.join(GAME_PATH, 'shaderpacks'));
            await fs.ensureDir(path.join(GAME_PATH, 'versions'));
            await fs.ensureDir(path.join(GAME_PATH, 'libraries'));
        }

        // Créer un dossier temporaire pour le launcher si nécessaire
        const tempPath = path.join(app.getPath('temp'), '.elysia-temp');
        if (!fs.existsSync(tempPath)) {
            fs.mkdirSync(tempPath, { recursive: true });
        }

        return true;
    } catch (error) {
        console.error('Erreur lors du vidage du cache:', error);
        return false;
    }
}

// Écouteur pour les interactions avec le gestionnaire de ressources (à côté des autres écouteurs)
ipcMain.on('clear-cache', async (event) => {
    try {
        const success = await clearLauncherCache();
        event.sender.send('cache-cleared', { success });
    } catch (error) {
        console.error('Erreur lors du vidage du cache:', error);
        event.sender.send('cache-cleared', { success: false, error: error.message });
    }
});

// Écouteurs pour la gestion des ressources (existants)
ipcMain.on('install-resources', async (event) => {
    try {
        // Recréer les dossiers au cas où
        await resourceManager.initialize();
        
        // Récupérer le chemin du fichier resources.json
        const resourcesJsonPath = await findResourcesJsonPath();
        
        // Charger et installer les ressources depuis la configuration
        const resourcesConfig = JSON.parse(await fs.readFile(resourcesJsonPath, 'utf8'));
        
        // Installation des resource packs
        for (const pack of resourcesConfig.resourcepacks || []) {

            await resourceManager.installResourcePack(pack.url, event);
        }
        
        // Installation des shaders
        for (const shader of resourcesConfig.shaders || []) {

            await resourceManager.installShader(shader.url, event);
        }
        
        return true;
    } catch (error) {
        console.error('Erreur lors de l\'installation des ressources:', error);
        throw error;
    }
});

// Écouteur pour les interactions avec le gestionnaire d'anti-cheat
ipcMain.on('anti-cheat-check', async (event, data) => {
    const result = await antiCheat.runCheck(data.username, SERVER_NAME);
    event.reply('anti-cheat-result', result);
});

// Écouteur pour vider le cache
ipcMain.on('clear-cache', async (event) => {
    try {
        const success = await clearLauncherCache();
        event.sender.send('cache-cleared', { success });
    } catch (error) {
        console.error('Erreur lors du vidage du cache:', error);
        event.sender.send('cache-cleared', { success: false, error: error.message });
    }
});

// Gérer l'installation de Java depuis l'UI
ipcMain.handle('install-java', async (event) => {
    try {
        // Installer Java
        await downloadAndInstallJava(event);
        
        // Informer l'interface que Java est installé
        mainWindow.webContents.send('java-installed', {
            message: 'Java 21 a été installé avec succès',
            path: store.get('java.path')
        });
        
        return { success: true };
    } catch (error) {
        console.error('Erreur lors de l\'installation de Java:', error);
        return { success: false, error: error.message };
    }
});

// Ajouter cette nouvelle fonction pour sauvegarder le paramètre RAM
ipcMain.handle('save-memory-setting', (event, memoryValue) => {
    try {
        store.set('memory-setting', memoryValue);
        return true;
    } catch (error) {
        console.error('Erreur lors de la sauvegarde du paramètre RAM:', error);
        return false;
    }
});

// Ajouter cette nouvelle fonction pour récupérer le paramètre RAM
ipcMain.handle('get-memory-setting', () => {
    try {
        return store.get('memory-setting', 4); // La valeur par défaut est 4
    } catch (error) {
        console.error('Erreur lors de la récupération du paramètre RAM:', error);
        return 4; // La valeur par défaut est 4
    }
});

// Ajouter cette fonction pour rafraîchir le token Minecraft
async function refreshMinecraftToken() {
    try {
        const savedToken = store.get('minecraft-token-refresh');
        
        if (!savedToken) {
            console.log('Aucun token de rafraîchissement disponible, authentification complète requise');
            return false;
        }
        
        console.log('Tentative de rafraîchissement du token Minecraft...');
        
        // Tenter de rafraîchir le token
        const xboxManager = await authManager.refresh(savedToken);
        // Obtenir un nouveau token Minecraft
        const token = await xboxManager.getMinecraft();
        
        // Sauvegarder le nouveau token et le profil
        const profile = {
            name: token.profile.name,
            id: token.profile.id
        };
        
        store.set('minecraft-token', token.mclc());
        store.set('minecraft-profile', profile);
        
        // Sauvegarder le token de rafraîchissement pour une utilisation ultérieure
        store.set('minecraft-token-refresh', xboxManager.msToken.refresh_token);
        
        console.log('Token Minecraft rafraîchi avec succès');
        return true;
    } catch (error) {
        console.error('Erreur lors du rafraîchissement du token:', error);
        return false;
    }
}

// Fonction pour activer/désactiver le mod FirstPerson
async function toggleFirstPersonMod(enable) {
    try {
        const modsPath = path.join(app.getPath('appData'), '.elysia', 'mods');
        await fs.ensureDir(modsPath);
        
        // Get the correct filename from resources.json
        const resourcesPath = path.join(__dirname, 'resources.json');
        const resourcesData = await fs.readJson(resourcesPath);
        
        // Find the First Person mod entry
        const firstPersonMod = resourcesData.mods.find(mod => mod.name === "First Person");
        
        if (!firstPersonMod) {
            console.error("First Person mod not found in resources.json");
            return { success: false, error: "First Person mod not found in configuration" };
        }
        
        // Extract the filename from the URL
        const modUrl = firstPersonMod.url;
        const modFileName = modUrl.substring(modUrl.lastIndexOf('/') + 1);
        
        // Check if the mod file exists in either active or disabled state
        const files = await fs.readdir(modsPath);
        const modFile = files.find(file => 
            file === modFileName || file === `${modFileName}.disabled`
        );
        
        if (!modFile) {
            console.log("First Person mod file not found, may need to be downloaded first");
            return { success: true, needsDownload: true };
        }
        
        const filePath = path.join(modsPath, modFile);
        
        if (enable) {
            // Si le fichier est désactivé (se termine par .disabled)
            if (modFile.endsWith('.disabled')) {
                const newPath = path.join(modsPath, modFile.replace('.disabled', ''));
                await fs.rename(filePath, newPath);
                console.log(`Mod activé: ${modFile} -> ${modFile.replace('.disabled', '')}`);
            }
        } else {
            // Si le fichier est activé (ne se termine pas par .disabled)
            if (!modFile.endsWith('.disabled')) {
                const newPath = path.join(modsPath, `${modFile}.disabled`);
                await fs.rename(filePath, newPath);
                console.log(`Mod désactivé: ${modFile} -> ${modFile}.disabled`);
            }
        }
        
        return { success: true };
    } catch (error) {
        console.error('Erreur lors de la modification du statut du mod FirstPerson:', error);
        return { success: false, error: error.message };
    }
}

// Fonction pour vérifier l'état actuel du mod FirstPerson
async function checkFirstPersonModStatus() {
    try {
        const modsPath = path.join(app.getPath('appData'), '.elysia', 'mods');
        await fs.ensureDir(modsPath);
        
        // Get the correct filename from resources.json
        const resourcesPath = path.join(__dirname, 'resources.json');
        const resourcesData = await fs.readJson(resourcesPath);
        
        // Find the First Person mod entry
        const firstPersonMod = resourcesData.mods.find(mod => mod.name === "First Person");
        
        if (!firstPersonMod) {
            console.error("First Person mod not found in resources.json");
            return { success: false, error: "First Person mod not found in configuration" };
        }
        
        // Extract the filename from the URL
        const modUrl = firstPersonMod.url;
        const modFileName = modUrl.substring(modUrl.lastIndexOf('/') + 1);
        
        // Check if the mod file exists in either active or disabled state
        const files = await fs.readdir(modsPath);
        const modFile = files.find(file => 
            file === modFileName || file === `${modFileName}.disabled`
        );
        
        if (!modFile) {
            return { success: true, enabled: false };
        }
        
        return { success: true, enabled: !modFile.endsWith('.disabled') };
    } catch (error) {
        console.error('Erreur lors de la vérification du statut du mod FirstPerson:', error);
        return { success: false, error: error.message };
    }
}

// Handlers pour les fonctions IPC
ipcMain.handle('toggle-firstperson-mod', async (event, enable) => {
    return await toggleFirstPersonMod(enable);
});

ipcMain.handle('get-firstperson-status', async () => {
    return await checkFirstPersonModStatus();
});

// Vérification de l'authentification au démarrage
app.on('ready', async () => {
  const token = store.get('minecraft-token');
  const profile = store.get('minecraft-profile');
  
  if (token && profile) {
    try {
      // Vérifier si le token est toujours valide
      // Si non, essayer de le rafraîchir
      const isValid = await refreshMinecraftToken();
      
      if (isValid && mainWindow && !mainWindow.isDestroyed()) {
        const refreshedProfile = store.get('minecraft-profile');
        mainWindow.webContents.send('auth-status', {
          isAuthenticated: true,
          profile: refreshedProfile
        });
      } else {
        // Si le rafraîchissement a échoué ou que la fenêtre n'est pas disponible,
        // ne pas envoyer d'état d'authentification
        console.log('Le token n\'a pas pu être rafraîchi ou la fenêtre n\'est pas disponible');
      }
    } catch (error) {
      console.error('Erreur lors de la vérification de l\'authentification:', error);
    }
  }
});

// Gestionnaire pour la sauvegarde de la sélection de serveur
ipcMain.handle('save-server-selection', (event, serverName) => {
    console.log(`Sauvegarde de la sélection de serveur: ${serverName}`);
    try {
        store.set('selected-server', serverName);
        return { success: true };
    } catch (error) {
        console.error('Erreur lors de la sauvegarde de la sélection de serveur:', error);
        return { success: false, error: error.message };
    }
});

// Gestionnaire pour obtenir les chemins d'accès aux ressources
ipcMain.handle('get-asset-path', (event, assetType, fileName) => {
    console.log(`Récupération du chemin pour ${assetType}/${fileName}`);
    try {
        const assetPath = path.join(__dirname, 'assets');
        
        let filePath;
        if (assetType === 'backgrounds') {
            filePath = path.join(assetPath, 'backgrounds', fileName);
        } else {
            filePath = path.join(assetPath, fileName);
        }
        
        // Vérifier si le fichier existe
        if (fs.existsSync(filePath)) {
            console.log(`Fichier trouvé: ${filePath}`);
            return { success: true, path: filePath, url: `file://${filePath.replace(/\\/g, '/')}` };
        } else {
            console.error(`Fichier non trouvé: ${filePath}`);
            return { success: false, error: 'Fichier non trouvé', searchedPath: filePath };
        }
    } catch (error) {
        console.error('Erreur lors de la récupération du chemin de ressource:', error);
        return { success: false, error: error.message };
    }
});

// Anti-cheat désactivé pour éviter les faux positifs avec les antivirus
// const AntiCheat = require('./modules/anti-cheat');

// Configuration du stockage local
// ... existing code ...

// Fonction pour interroger un serveur Minecraft et obtenir les informations des joueurs
async function queryMinecraftServer(host, port = 25565) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let data = Buffer.alloc(0);
    let responseReceived = false;
    
    // Timeout après 5 secondes
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error('Timeout lors de la connexion au serveur'));
    });

    socket.connect(port, host, () => {
      console.log(`Connexion établie avec ${host}:${port}`);
      
      // Envoyer un packet handshake puis un packet status
      try {
      const handshakePacket = buildHandshakePacket(host, port);
      const statusPacket = Buffer.from([0x01, 0x00]);
      
      socket.write(handshakePacket);
      socket.write(statusPacket);
        
        console.log('Packets handshake et status envoyés');
      } catch (err) {
        console.error('Erreur lors de l\'envoi des packets:', err);
        socket.destroy();
        reject(err);
      }
    });

    socket.on('data', (chunk) => {
      console.log(`Données reçues: ${chunk.length} octets`);
      data = Buffer.concat([data, chunk]);
      
      try {
        // Essayer de parser la réponse
        const response = parseResponse(data);
        responseReceived = true;
        socket.end();
        resolve(response);
      } catch (e) {
        // Si on ne peut pas encore parser, attendre plus de données
        if (e.message !== 'Données incomplètes') {
          console.error('Erreur de parsing:', e.message);
          socket.end();
          reject(e);
        } else {
          console.log('Données incomplètes, en attente de plus de données...');
        }
      }
    });

    socket.on('error', (err) => {
      console.error(`Erreur de socket: ${err.message}`);
      reject(err);
    });

    socket.on('end', () => {
      console.log('Connexion terminée par le serveur');
      if (!responseReceived) {
        reject(new Error('La connexion a été fermée sans réponse complète'));
      }
    });

    socket.on('close', () => {
      console.log('Connexion fermée');
      if (!responseReceived) {
      reject(new Error('Connexion fermée sans réponse complète'));
      }
    });
  });
}

// Fonction pour construire le packet handshake
function buildHandshakePacket(host, port) {
  const hostBytes = Buffer.from(host, 'utf8');
  
  // Calculer la taille du packet: 
  // 1 (packet ID) + 1 (protocol version) + 1 (host length) + hostBytes.length + 2 (port) + 1 (next state)
  const packetLength = 1 + 1 + 1 + hostBytes.length + 2 + 1;
  
  // Calculer la taille du VarInt pour la longueur du packet
  const packetLengthVarInt = writeVarInt(packetLength);
  
  // Créer le buffer pour le packet complet
  const packet = Buffer.alloc(packetLengthVarInt.length + packetLength);
  
  let offset = 0;
  
  // Écrire la longueur du packet
  packetLengthVarInt.copy(packet, offset);
  offset += packetLengthVarInt.length;
  
  // Écrire l'ID du packet (0x00 pour handshake)
  packet.writeUInt8(0x00, offset);
  offset += 1;
  
  // Écrire la version du protocole (VarInt 47 pour 1.8+, 340 pour 1.12.2, 754 pour 1.16.5, 760 pour 1.21.1)
  packet.writeUInt8(0x00, offset); // Utiliser protocol -1 (status ping)
  offset += 1;
  
  // Écrire la longueur de l'hôte
  packet.writeUInt8(hostBytes.length, offset);
  offset += 1;
  
  // Écrire l'hôte
  hostBytes.copy(packet, offset);
  offset += hostBytes.length;
  
  // Écrire le port
  packet.writeUInt16BE(port, offset);
  offset += 2;
  
  // Écrire l'état suivant (1 pour status)
  packet.writeUInt8(0x01, offset);
  
  return packet;
}

// Fonction pour écrire un VarInt
function writeVarInt(value) {
  const bytes = [];
  
  do {
    let temp = value & 0x7F;
    value >>>= 7;
    if (value !== 0) {
      temp |= 0x80;
    }
    bytes.push(temp);
  } while (value !== 0);
  
  return Buffer.from(bytes);
}

// Fonction pour parser la réponse du serveur
function parseResponse(data) {
  // Vérifier si nous avons au moins la taille du packet
  if (data.length < 5) {
    throw new Error('Données incomplètes');
  }
  
  // Le premier byte peut être un VarInt qui indique la longueur des données
  // Nous devons décoder le VarInt et nous assurer d'avoir suffisamment de données
  let offset = 0;
  let packetLength = 0;
  let shift = 0;
  
  // Lire le VarInt de la longueur du packet
  do {
    if (offset >= data.length) {
      throw new Error('Données incomplètes');
    }
    
    const b = data.readUInt8(offset++);
    packetLength |= (b & 0x7F) << shift;
    shift += 7;
    
    if (shift > 35) {
      throw new Error('VarInt trop long');
    }
    
    if ((b & 0x80) === 0) {
      break;
    }
  } while (true);
  
  // Vérifier si nous avons toutes les données du packet
  if (data.length < offset + packetLength) {
    throw new Error('Données incomplètes');
  }
  
  // Lire l'ID du packet (devrait être 0x00 pour la réponse de statut)
  const packetId = data.readUInt8(offset);
  offset += 1;
  
  if (packetId !== 0x00) {
    throw new Error(`ID de packet invalide: ${packetId}`);
  }
  
  // Lire la longueur de la chaîne JSON (peut être un VarInt ou un simple UInt)
  let jsonLength = 0;
  shift = 0;
  
  // Essayer de lire comme un VarInt
  do {
    if (offset >= data.length) {
      throw new Error('Données incomplètes');
    }
    
    const b = data.readUInt8(offset++);
    jsonLength |= (b & 0x7F) << shift;
    shift += 7;
    
    if (shift > 35) {
      throw new Error('VarInt trop long');
    }
    
    if ((b & 0x80) === 0) {
      break;
    }
  } while (true);
  
  // Vérifier si nous avons assez de données
  if (data.length < offset + jsonLength) {
    throw new Error('Données incomplètes');
  }
  
  // Lire la chaîne JSON
  const jsonStr = data.toString('utf8', offset, offset + jsonLength);
  
  try {
    console.log('Réponse JSON reçue:', jsonStr);
    const serverInfo = JSON.parse(jsonStr);
    return {
      online: serverInfo.players?.online || 0,
      max: serverInfo.players?.max || 0,
      description: serverInfo.description?.text || serverInfo.description || '',
      version: serverInfo.version?.name || ''
    };
  } catch (e) {
    console.error('Contenu JSON invalide:', jsonStr);
    throw new Error('Erreur lors de l\'analyse de la réponse JSON: ' + e.message);
  }
}

// Exposer la fonction à l'interface utilisateur
ipcMain.handle('query-server', async (event, { host, port }) => {
  try {
    console.log(`Tentative de connexion au serveur Minecraft: ${host}:${port}`);
    const result = await queryMinecraftServer(host, port);
    console.log(`Informations du serveur: ${JSON.stringify(result)}`);
    return {
      success: true,
      ...result
    };
  } catch (error) {
    console.error('Erreur lors de la requête au serveur:', error);
    return { 
      success: false,
      error: error.message, 
      online: 0, 
      max: 0,
      description: 'Serveur non disponible'
    };
  }
});

// Configuration du stockage local
// ... existing code ...

// Fonction pour traiter les URLs minecraft://
function processMinecraftUrl(url) {
  try {
    console.log(`Traitement de l'URL minecraft:// reçue: ${url}`);
    
    // Extraire les paramètres de l'URL
    const urlObj = new URL(url);
    const serverAddress = urlObj.hostname;
    const portStr = urlObj.port;
    const port = portStr ? parseInt(portStr) : 25565;
    
    console.log(`Serveur extrait: ${serverAddress}:${port}`);
    
    // Si la fenêtre principale existe et n'est pas détruite, y envoyer l'information
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('minecraft-url-received', {
        serverAddress,
        port
      });
    } else {
      console.warn('La fenêtre principale n\'existe pas ou a été détruite lors du traitement de l\'URL');
    }
  } catch (error) {
    console.error('Erreur lors du traitement de l\'URL minecraft://', error);
  }
}

async function startApp() {
    // Vérifie si une instance est déjà en cours d'exécution
    const isFirstInstance = app.requestSingleInstanceLock();
    
    if (!isFirstInstance) {
        app.quit();
        return;
    }
    
    // Sélectionne automatiquement le protocole minecraft:// et urls minecraft quand trouvés
    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient('minecraft', process.execPath, [
                path.resolve(process.argv[1])
            ]);
        }
    } else {
        app.setAsDefaultProtocolClient('minecraft');
    }
    
    // Configure les événements pour la seconde instance
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Si une seconde instance est lancée, l'utilisateur a cliqué sur un lien minecraft://
        // Assurer que la fenêtre principale existe et est valide
        if (!mainWindow || mainWindow.isDestroyed()) {
            // La fenêtre a été fermée : on en recrée une nouvelle
            createWindow();
        } else {
            // Restaurer le focus sur la fenêtre existante
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!mainWindow.isDestroyed()) {
                mainWindow.focus();
            }
        }

        // Recherche d'un protocole minecraft:// dans la ligne de commande
        const urlArg = commandLine.find(arg => typeof arg === 'string' && arg.startsWith('minecraft://'));
        if (urlArg) {
            processMinecraftUrl(urlArg);
        }
    });
    
    app.on('open-url', (event, url) => {
        event.preventDefault();

        // Si la fenêtre principale n'existe plus (par exemple après un redémarrage du launcher)
        // on la recrée avant de traiter l'URL.
        if (!mainWindow || mainWindow.isDestroyed()) {
            // Créer (ou recréer) la fenêtre principale puis traiter l'URL une fois prête
            createWindow();
            app.whenReady().then(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.once('ready-to-show', () => processMinecraftUrl(url));
                }
            });
        } else {
            processMinecraftUrl(url);
        }
    });
    
    app.whenReady().then(async () => {
        createWindow();
        
        // Initialise Discord Rich Presence
        await discordRPC.initialize();
        discordRPC.setInLauncher();
        
        // Vérifie les mises à jour au démarrage
        await checkForUpdates();
        
        // Vérifie l'intégrité du jeu au démarrage
        await checkFileIntegrity();
        
        // Vérifie Java au démarrage
        await checkJavaAtStartup();

        app.on('activate', function () {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
    
    // Ajouter la fermeture de Discord RPC lors de la fermeture de l'application
    app.on('will-quit', () => {
        discordRPC.disconnect();
    });
}

startApp();
