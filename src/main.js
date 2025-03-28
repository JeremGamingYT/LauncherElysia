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
const AutoUpdater = require('./modules/auto-updater');
const ResourceManager = require('./modules/resource-manager');
const AntiCheat = require('./modules/anti-cheat');
const NewsModules = require('./modules/news');

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
const RPC = require('discord-rpc');
const clientId = '1296879619563327498';

// Crée un client RPC
const rpc = new RPC.Client({ transport: 'ipc' });

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
const antiCheat = new AntiCheat(GAME_PATH);

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
        title: 'Elysia - v.1.7.2 (BETA)',
        versions: ['1.7.2'],
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
        backgroundColor: '#00000000'
    });

    const templatePath = path.join(__dirname, 'views', 'splash.ejs');
    const template = fs.readFileSync(templatePath, 'utf-8');
    const logoPath = path.join(__dirname, 'assets', 'logo.png').replace(/\\/g, '/');
    
    const html = ejs.render(template, {
        version: app.getVersion(),
        logoPath: `file://${logoPath}`
    });

    const tempPath = path.join(app.getPath('temp'), 'splash.html');
    fs.writeFileSync(tempPath, html);
    splashWindow.loadFile(tempPath);

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
        mainWindow.show();

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

// Modifier la fonction verifyFiles pour gérer les cas où modsList n'est pas un tableau
async function verifyFiles(event, modsList) {
    try {
        if (!Array.isArray(modsList)) {
            console.warn('modsList invalide, utilisation tableau vide');
            modsList = [];
        }

        const modsPath = path.join(GAME_PATH, 'mods');
        await fs.ensureDir(modsPath);

        const verificationResults = await Promise.all(
            modsList.map(async (mod) => {
                const fileName = path.basename(new URL(mod.url).pathname);
                const filePath = path.join(modsPath, fileName);
                
                // Vérifier existence fichier
                const exists = await fs.pathExists(filePath);
                if (!exists) return { file: fileName, status: 'missing' };

                // Vérifier intégrité fichier
                const expectedHash = await calculateFileHashFromUrl(mod.url);
                const actualHash = await calculateFileHash(filePath);
                
                return {
                    file: fileName,
                    status: actualHash === expectedHash ? 'valid' : 'modified'
                };
            })
        );

        return {
            missingFiles: verificationResults.filter(r => r.status === 'missing').map(r => r.file),
            modifiedFiles: verificationResults.filter(r => r.status === 'modified').map(r => r.file)
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
        const modsDir = path.join(GAME_PATH, 'mods');
        const modsList = await fs.readJson(path.join(__dirname, 'resources.json'));
        
        // Vérifier seulement l'existence des fichiers, pas leur contenu
        for (const mod of modsList) {
            const fileName = path.basename(new URL(mod.url).pathname);
            const modPath = path.join(modsDir, fileName);
            
            if (!await fs.pathExists(modPath)) {
                console.log(`Mod manquant: ${fileName}`);
                return false;
            }
        }
        return true;
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
        const { mods } = await fs.readJson(path.join(__dirname, 'resources.json')); // Extraction du tableau mods
        const modsDir = path.join(GAME_PATH, 'mods');

        if (!await fs.pathExists(modsDir)) return false;

        // Vérifier chaque mod
        for (const mod of mods) { // Utilisation directe du tableau mods
            const fileName = path.basename(new URL(mod.url).pathname);
            const modFilePath = path.join(modsDir, fileName);
            
            if (!await fs.pathExists(modFilePath)) {
                console.log(`Mod manquant: ${fileName}`);
                return false;
            }
        }
        return true;
    } catch (error) {
        console.error('Erreur vérification mods:', error);
        return false;
    }
}

// Nouvelle version avec détection du mode production et meilleure gestion d'erreurs
async function installMods(event) {
    try {
        // Récupérer le chemin du fichier resources.json
        const resourcesJsonPath = await findResourcesJsonPath();
        const resourcesDirectory = path.dirname(resourcesJsonPath);
        const modsDestPath = path.join(app.getPath('appData'), '.elysia', 'mods');
        
        await fs.ensureDir(modsDestPath);
        const { mods } = await fs.readJson(resourcesJsonPath);
        const totalMods = mods.length;
        let installedMods = 0;
        let failedMods = 0;
        let notFoundMods = [];
    
        for (const mod of mods) {
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
        const serversPath = path.join(GAME_PATH, 'servers.dat');
        console.log('Configuration du serveur par défaut à:', serversPath);
        
        // Créer un fichier servers.dat préformaté (format NBT binaire)
        // Ce fichier contient un serveur avec:
        // - name: "Elysia"
        // - ip: "91.197.6.212:25580"
        // - hidden: false
        // - preventsChatsReports: false
        const serverData = Buffer.from([
            10, 0, 0,                 // Compound sans nom (racine)
            9, 0, 7, 115, 101, 114, 118, 101, 114, 115,  // "servers" (liste)
            10, 0, 0, 0, 1,           // 1 élément compound dans la liste
            
            // Début du serveur (compound)
            1, 0, 6, 104, 105, 100, 100, 101, 110, 0,  // hidden: 0 (byte)
            1, 0, 19, 112, 114, 101, 118, 101, 110, 116, 115, 67, 104, 97, 116, 82, 101, 112, 111, 114, 116, 115, 0,  // preventsChatsReports: 0 (byte)
            8, 0, 2, 105, 112, 0, 18, 59, 49, 46, 49, 57, 55, 46, 54, 46, 50, 49, 50, 58, 50, 53, 53, 56, 48,  // ip: "91.197.6.212:25580" (string)
            8, 0, 4, 110, 97, 109, 101, 0, 6, 69, 108, 121, 115, 105, 97,  // name: "Elysia" (string)
            0,  // Fin du compound serveur
            
            0   // Fin du compound racine
        ]);
        
        // S'assurer que le répertoire cible existe
        await fs.ensureDir(GAME_PATH);
        
        // Écrire le fichier préformaté
        await fs.writeFile(serversPath, serverData);
        
        console.log('Serveur par défaut ajouté avec succès');
        return true;
    } catch (error) {
        console.error('Erreur lors de la configuration du serveur par défaut:', error);
        console.error(error.stack); // Afficher la stack trace complète
        // On continue même en cas d'erreur
        return false;
    }
}

// Modification du handler d'installation pour ajouter la configuration du serveur
ipcMain.handle('install-game', async (event) => {
    try {
        // Vérifier et installer Java si nécessaire
        const javaValid = await verifyJavaInstallation();
        if (!javaValid) {
            event.sender.send('install-progress', { stage: 'java-setup', message: 'Installation de Java...' });
            await downloadAndInstallJava(event);
        }

        // Copier launcher_profiles.json avant l'installation
        await copyLauncherProfiles();

        // Vérifier l'installation de Minecraft
        const minecraftValid = await verifyMinecraftInstallation();
        if (!minecraftValid) {
            event.sender.send('install-progress', { stage: 'installing-minecraft', message: 'Installation de Minecraft...' });
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
            event.sender.send('install-progress', { stage: 'installing-mods', message: 'Installation des mods...' });
            await installMods(event);
        } else {
            console.log('Mods are already installed and up to date, skipping reinstallation.');
        }

        // Vérifier et installer les ressources
        const resourcesValid = await resourceManager.verifyResources();
        if (!resourcesValid) {
            event.sender.send('install-progress', {
                stage: 'installing-resources',
                message: 'Installation des ressources...'
            });
            await installResources(event);
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
        
        // Réinitialiser les variables
        gameStartTime = null;
        currentPlayTime = finalPlayTime;
        
        // Envoyer la mise à jour finale à l'interface utilisateur
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('play-time-update', {
                playTime: finalPlayTime,
                formattedTime: formatPlayTime(finalPlayTime)
            });
        }
    }
}

// Modification de la fonction launchMinecraft pour suivre la documentation
async function launchMinecraft(event, options) {
    try {
        // Vérifier et rafraîchir le token si nécessaire
        const token = store.get('minecraft-token');
        if (!token) {
            throw new Error('Veuillez vous connecter avec votre compte Microsoft');
        }

        // Vérifier la présence de launcher_profiles.json
        const profilePath = path.join(GAME_PATH, 'launcher_profiles.json');
        if (!await fs.pathExists(profilePath)) {
            console.log('launcher_profiles.json manquant avant le lancement, tentative de copie...');
            await copyLauncherProfiles();
        }

        await renameFabricJson();

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
                max: options.maxMemory || "2G",
                min: options.minMemory || "1G"
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

        launcher.on('close', (code) => {
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

        // Configurer le scan périodique de l'anti-cheat si activé
        let antiCheatInterval = null;

        if (SERVER_NAME) {
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
        }

        // Envoyer la confirmation de démarrage
        event.sender.send('game-started');

        // Nettoyer l'intervalle lorsque le jeu se termine
        launcher.on('close', () => {
            // Arrêter le suivi du temps de jeu
            stopPlayTimeTracking();
            
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

        // Remplacer la vérification d'intégrité par une simple existence
        const modsValid = await verifyModsInstallation();
        if (!modsValid) {
            event.sender.send('install-progress', {
                stage: 'installing-mods',
                message: 'Installation des mods manquants...'
            });
            await installMods(event);
        }

        // Vérifier les ressources (resource packs et shaders)
        const resourcesValid = await resourceManager.verifyResources();
        if (!resourcesValid) {
            event.sender.send('install-progress', {
                stage: 'installing-resources',
                message: 'Création des dossiers et installation des ressources...'
            });
            await installResources(event);
        }

        // Configurer le serveur par défaut
        event.sender.send('install-progress', {
            stage: 'configuring-server',
            message: 'Configuration du serveur par défaut...'
        });
        console.log('Configuration du serveur par défaut avant le lancement...');
        try {
            const serverSetupResult = await setupDefaultServer();
            console.log('Résultat de la configuration du serveur:', serverSetupResult ? 'Succès' : 'Échec');
        } catch (serverError) {
            console.error('Erreur critique lors de la configuration du serveur:', serverError);
        }

        // Lancer le jeu
        const launchResult = await launchMinecraft(event, options);
        return {
            success: true,
            ...launchResult
        };
    } catch (error) {
        console.error('Erreur lors du lancement:', error);
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
    
    return {
        playTime: playTime,
        version: app.getVersion() || '1.7.2' // Utiliser la version du launcher au lieu de Minecraft
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
        const exeName = path.basename(process.execPath);
        const installLocation = path.dirname(process.execPath);
        const uninstallerPath = path.join(installLocation, 'Uninstall ' + exeName);
        
        if (fs.existsSync(uninstallerPath)) {
            // Démarrer le désinstallateur
            require('child_process').spawn(uninstallerPath, [], {
                detached: true,
                stdio: 'ignore'
            }).unref();
            
            // Fermer l'application
            app.quit();
            return true;
        } else {
            console.error('Désinstallateur introuvable:', uninstallerPath);
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
        const success = await clearLauncherCache();
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
            event.sender.send('install-progress', {
                stage: 'installing-resourcepack',
                message: `Installation du pack de ressources: ${pack.name}`
            });
            await resourceManager.installResourcePack(pack.url, event);
        }
        
        // Installation des shaders
        for (const shader of resourcesConfig.shaders || []) {
            event.sender.send('install-progress', {
                stage: 'installing-shader',
                message: `Installation du shader: ${shader.name}`
            });
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
                            version: app.getVersion() || '1.7.2',
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
                version: app.getVersion() || '1.7.2',
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
            event.sender.send('install-progress', {
                stage: 'installing-resourcepack',
                message: `Installation du pack de ressources: ${pack.name}`
            });
            await resourceManager.installResourcePack(pack.url, event);
        }
        
        // Installation des shaders
        for (const shader of resourcesConfig.shaders || []) {
            event.sender.send('install-progress', {
                stage: 'installing-shader',
                message: `Installation du shader: ${shader.name}`
            });
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