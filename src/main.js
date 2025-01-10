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
const { install, getVersionList, installDependencies } = require('@xmcl/installer');
const { MinecraftLocation, Version } = require('@xmcl/core');
const { Agent } = require('undici');
const AutoUpdater = require('./modules/auto-updater');
const ResourceManager = require('./modules/resource-manager');
const SecurityChecker = require('./modules/security-checker');

// Configuration du stockage local
const store = new Store();
const authManager = new Auth("select_account");
const autoUpdater = new AutoUpdater('JeremGamingYT', 'LauncherElysia');

// Variables globales pour la gestion des processus
let gameProcess = null;
let mainWindow = null;
let authData = null;
let gameRunning = false;
let gameInstalled = false;
let splashWindow = null;
let securityChecker = null;

// Discord 'Rich presence'
const RPC = require('discord-rpc');
const clientId = '1296879619563327498';

// Crée un client RPC
const rpc = new RPC.Client({ transport: 'ipc' });

// Constantes pour Fabric et chemins
const GAME_PATH = path.join(app.getPath('appData'), '.elysia');
const javaPath = store.get('java.path', 'C:\\Program Files\\Java\\jdk-17\\bin\\javaw.exe')
const FABRIC_VERSION = '0.16.10';
const FABRIC_VERSION_LAUNCHER = 'fabric-loader-0.16.10-1.21';
const FABRIC_INSTALLER_URL = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.1/fabric-installer-1.0.1.jar`;
const FABRIC_INSTALLER_PATH = path.join(app.getPath('temp'), `fabric-installer-1.0.1.jar`);

const tempDir = path.join(app.getPath('temp')); // Récupère le dossier Temp
const fabricInstallerName = 'fabric-installer-1.0.1.jar'; // Nom du fichier
const fabricPath = path.join(tempDir, fabricInstallerName); // Combine le chemin et le nom du fichier

const JAVA_DOWNLOAD_URL = 'download.oracle.com/java/17/archive/jdk-17.0.12_windows-x64_bin.exe';
const JAVA_INSTALLER_PATH = path.join(app.getPath('temp'), 'jdk-17-installer.exe');

// Ajouter avec les autres constantes
const resourceManager = new ResourceManager(GAME_PATH);

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
        height: 800,
        minWidth: 1280,
        minHeight: 800,
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
        title: 'Elysia',
        versions: ['Beta'],
        memoryOptions: [2, 4, 6, 8],
        news: [
            {
                title: '🚀 Update 9 - Migration vers Fabric 1.21',
                content: 'La migration vers Fabric 1.21 est maintenant terminée. Vous pouvez maintenant profiter de la nouvelle version du launcher.'
            },
            {
                title: 'À venir: Nouvelle interface.',
                content: 'Une nouvelle interface est en cours de développement.'
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

    mainWindow.on('close', async (event) => {
        if (gameRunning) {
            event.preventDefault(); // Empêcher la fermeture immédiate
            await killMinecraftProcess();
            gameRunning = false;
            mainWindow.destroy(); // Fermer la fenêtre après avoir tué le processus
        }
    });

    // Initialiser le système de sécurité
    const initSecurity = async () => {
        securityChecker = new SecurityChecker(GAME_PATH);
        await securityChecker.initialize();
    };
    initSecurity();

    // Gérer les détections 
    securityChecker.on('detection', async (data) => {
        // Créer une nouvelle fenêtre pour l'alerte
        const alertWindow = new BrowserWindow({
            width: 800,
            height: 600,
            frame: false,
            transparent: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            },
            parent: mainWindow,
            modal: true,
            resizable: true,
            minWidth: 600,
            minHeight: 400
        });

        // Centrer la fenêtre sur l'écran parent
        alertWindow.center();

        // Charger le template d'alerte
        const templatePath = path.join(__dirname, 'views', 'security-alert.ejs');
        const template = fs.readFileSync(templatePath, 'utf-8');
        
        const html = ejs.render(template, {
            allDetections: data.allDetections,
            path: path
        });
        
        const tempPath = path.join(app.getPath('temp'), 'security-alert.html');
        fs.writeFileSync(tempPath, html);
        alertWindow.loadFile(tempPath);
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

// Ajouter la vérification des mises à jour au démarrage de l'application
app.whenReady().then(async () => {
    await createSplashWindow();

    try {
        // Vérification des mises à jour
        splashWindow.webContents.send('splash-status', {
            message: 'Recherche de mises à jour...',
            progress: 10
        });

        const updateInfo = await autoUpdater.checkForUpdates();
        
        if (updateInfo.hasUpdate && updateInfo.downloadUrl) {
            splashWindow.webContents.send('splash-status', {
                message: 'Téléchargement de la mise à jour...',
                progress: 20
            });

            // Écoutez les événements de progression du téléchargement
            autoUpdater.on('download-progress', (progressObj) => {
                splashWindow.webContents.send('splash-status', {
                    message: `Téléchargement: ${Math.round(progressObj.percent)}%`,
                    progress: 20 + (progressObj.percent * 0.6)
                });
            });

            const setupPath = await autoUpdater.downloadUpdate(updateInfo.downloadUrl);

            splashWindow.webContents.send('splash-status', {
                message: 'Installation de la mise à jour...',
                progress: 80
            });

            await autoUpdater.installUpdate(setupPath);
        }

        // Initialisation des composants
        splashWindow.webContents.send('splash-status', {
            message: 'Vérification des fichiers...',
            progress: 85
        });
        await verifyGameFiles();

        splashWindow.webContents.send('splash-status', {
            message: 'Chargement des configurations...',
            progress: 90
        });
        await loadConfigurations();

        splashWindow.webContents.send('splash-status', {
            message: 'Préparation du launcher...',
            progress: 95
        });
        await createWindow();

        // Finalisation
        splashWindow.webContents.send('splash-status', {
            message: 'Démarrage...',
            progress: 100
        });

        // Attendre un court instant pour montrer 100%
        await new Promise(resolve => setTimeout(resolve, 500));

        // Fermer le splash screen et afficher la fenêtre principale
        splashWindow.close();
        mainWindow.show();

    } catch (error) {
        console.error('Erreur lors du démarrage:', error);
        splashWindow.webContents.send('splash-error', {
            message: `Erreur: ${error.message}`
        });
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

// Fonction pour vérifier tous les mods
async function verifyFiles(fileList, basePath) {
    const verificationResults = {
        missingFiles: [],
        modifiedFiles: [],
        validFiles: []
    };

    for (const fileUrl of fileList) {
        const fileName = path.basename(fileUrl);
        const filePath = path.join(basePath, fileName);
        
        const result = await verifyMod(fileUrl, filePath);
        
        if (!result.exists) {
            verificationResults.missingFiles.push(fileUrl);
        } else if (result.needsUpdate) {
            verificationResults.modifiedFiles.push(fileUrl);
        } else {
            verificationResults.validFiles.push(fileUrl);
        }
    }

    return verificationResults;
}

// Fonction pour installer un seul mod
async function installSingleMod(modUrl, modPath, event) {
    try {
        const response = await axios.get(modUrl, { responseType: 'stream' });
        const writer = fs.createWriteStream(modPath);

        return new Promise((resolve, reject) => {
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch (error) {
        console.error(`Erreur lors de l'installation du mod ${path.basename(modPath)}:`, error);
        throw error;
    }
}

// Fonction optimisée pour installer uniquement les mods nécessaires
async function installMissingMods(modsToInstall, modsDestPath, event) {
    try {
        await fs.ensureDir(modsDestPath);
        const totalMods = modsToInstall.length;
        
        for (let i = 0; i < modsToInstall.length; i++) {
            const modUrl = modsToInstall[i];
            const modName = path.basename(modUrl);
            const modPath = path.join(modsDestPath, modName);

            event.sender.send('install-progress', {
                stage: 'downloading-mod',
                modName,
                progress: Math.round((i / totalMods) * 100)
            });

            await installSingleMod(modUrl, modPath, event);
        }

        return true;
    } catch (error) {
        console.error('Erreur lors de l\'installation des mods:', error);
        return false;
    }
}

// Fonction améliorée pour vérifier l'intégrité du jeu
async function checkFileIntegrity(event) {
    try {
        const modsList = await fs.readJson(path.join(__dirname, 'mods.json'));
        const modsPath = path.join(app.getPath('appData'), '.elysia', 'mods');

        event.sender.send('install-progress', { 
            stage: 'verifying-files',
            message: 'Vérification des fichiers...'
        });

        // 1) Vérifier l'état des fichiers requis (existant, modifié, etc.)
        const verificationResults = await verifyFiles(modsList, modsPath);
        
        // 2) Déterminer si une mise à jour est nécessaire (fichiers manquants ou modifiés)
        const needsUpdate = verificationResults.missingFiles.length > 0 || 
                           verificationResults.modifiedFiles.length > 0;

        // 3) Supprimer les mods qui ne figurent pas dans mods.json (fichiers en trop)
        const allLocalMods = await fs.readdir(modsPath); 
        const allRequiredModNames = modsList.map((url) => path.basename(url));
        for (const localMod of allLocalMods) {
            if (!allRequiredModNames.includes(localMod) && localMod.endsWith('.jar')) {
                const extraneousModPath = path.join(modsPath, localMod);
                console.log(`Fichier mod extraneous détecté et supprimé : ${localMod}`);
                await fs.remove(extraneousModPath);
            }
        }

        // 4) Installer les fichiers manquants ou modifiés, si nécessaire
        if (needsUpdate) {
            const modsToInstall = [
                ...verificationResults.missingFiles,
                ...verificationResults.modifiedFiles
            ];

            event.sender.send('install-progress', {
                stage: 'updating-files',
                message: `Installation de ${modsToInstall.length} fichier(s)...`
            });

            const installSuccess = await installMissingMods(modsToInstall, modsPath, event);
            return installSuccess;
        }

        return true; // Aucun changement requis
    } catch (error) {
        console.error('Erreur lors de la vérification des fichiers:', error);
        return false;
    }
}

// Fonction pour télécharger Fabric
async function downloadFabric(event) {
    const writer = fs.createWriteStream(FABRIC_INSTALLER_PATH);
    const response = await axios({
        url: FABRIC_INSTALLER_URL,
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

// Fonction pour installer Fabric
async function installFabric(event) {
    return new Promise((resolve, reject) => {
        const javaPath = store.get('java.path', 'java');
        const command = `"${javaPath}" -jar "${FABRIC_INSTALLER_PATH}" client -dir "${GAME_PATH}" -mcversion 1.21`;

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
                reject(new Error(`L'installation de Fabric a échoué avec le code ${code}`));
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

// Fonction pour lancer Minecraft vanilla temporairement
async function launchVanillaTemporary(event) {
    try {
        event.sender.send('install-progress', { stage: 'launching-vanilla', message: 'Lancement de Minecraft vanilla...' });
        
        const opts = {
            clientPackage: null,
            authorization: store.get('minecraft-token'),
            root: GAME_PATH,
            version: {
                number: '1.20.1',
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
        const version = await getVersionList().then(list => list.versions.find(v => v.id === '1.20.1'));
        
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
        const resolvedVersion = await Version.parse(GAME_PATH, '1.20.1');
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
    const defaultJavaPath = 'C:\\Program Files\\Java\\jdk-17\\bin\\javaw.exe';
    const storedJavaPath = store.get('java.path', defaultJavaPath);

    try {
        await fs.access(storedJavaPath);
        return true;
    } catch (error) {
        return false;
    }
}

// Fonction pour télécharger et installer Java
async function downloadAndInstallJava(event) {
    try {
        event.sender.send('install-progress', { stage: 'downloading-java', message: 'Téléchargement de Java...' });
        
        // Téléchargement de Java
        const writer = fs.createWriteStream(JAVA_INSTALLER_PATH);
        const response = await axios({
            url: `https://${JAVA_DOWNLOAD_URL}`,
            method: 'GET',
            responseType: 'stream'
        });

        await new Promise((resolve, reject) => {
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        event.sender.send('install-progress', { stage: 'installing-java', message: 'Installation de Java...' });

        // Installation silencieuse de Java
        await new Promise((resolve, reject) => {
            const child = exec(`"${JAVA_INSTALLER_PATH}" /s`, { windowsHide: true });
            child.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`L'installation de Java a échoué avec le code ${code}`));
            });
        });

        // Mise à jour du chemin Java dans le store
        store.set('java.path', 'C:\\Program Files\\Java\\jdk-17\\bin\\javaw.exe');
        return true;
    } catch (error) {
        console.error('Erreur lors de l\'installation de Java:', error);
        throw error;
    }
}

// Fonction pour copier le launcher_profiles.json
async function copyLauncherProfiles() {
    try {
        const minecraftPath = path.join(os.homedir(), 'AppData', 'Roaming', '.minecraft');
        const sourcePath = path.join(minecraftPath, 'launcher_profiles.json');
        const destPath = path.join(GAME_PATH, 'launcher_profiles.json');

        // Vérifier si le fichier source existe
        if (await fs.pathExists(sourcePath)) {
            // Vérifier si le fichier de destination n'existe pas déjà
            if (!await fs.pathExists(destPath)) {
                await fs.copy(sourcePath, destPath);
                console.log('launcher_profiles.json copié avec succès');
            } else {
                console.log('launcher_profiles.json existe déjà dans la destination');
            }
        } else {
            console.log('launcher_profiles.json non trouvé dans .minecraft');
        }
    } catch (error) {
        console.error('Erreur lors de la copie de launcher_profiles.json:', error);
    }
}

// Modification du handler d'installation
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
            await downloadFabric(event);
            await installFabric(event);
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
            
            // Charger et installer les ressources depuis la configuration
            const resourcesConfig = JSON.parse(await fs.readFile(path.join(process.cwd(), 'resources.json'), 'utf8'));
            
            for (const pack of resourcesConfig.resourcepacks || []) {
                await resourceManager.installResourcePack(pack.url, event);
            }
            
            for (const shader of resourcesConfig.shaders || []) {
                await resourceManager.installShader(shader.url, event);
            }
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
        const minecraftPath = path.join(GAME_PATH, 'versions', '1.20.1');
        const requiredFiles = [
            path.join(minecraftPath, '1.20.1.json'),
            path.join(minecraftPath, '1.20.1.jar')
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
        // Vérifier les fichiers de version Fabric
        const fabricVersionPath = path.join(GAME_PATH, 'versions', FABRIC_VERSION_LAUNCHER);
        const fabricLibPath = path.join(GAME_PATH, 'libraries', 'net', 'fabricmc', 'fabric-loader', FABRIC_VERSION);
        
        // Liste complète des fichiers requis
        const requiredFiles = [
            // Fichiers de version
            path.join(fabricVersionPath, `${FABRIC_VERSION_LAUNCHER}.json`),
            // Fichiers de bibliothèque
            path.join(fabricLibPath, `fabric-loader-${FABRIC_VERSION}.jar`)
        ];

        // Vérifier l'existence de tous les fichiers requis
        for (const file of requiredFiles) {
            if (!await fs.pathExists(file)) {
                console.log(`Fichier Fabric manquant: ${file}`);
                return false;
            }
            
            // Vérifier que les fichiers ne sont pas vides
            const stats = await fs.stat(file);
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

// Adding a new function for verifying mods
async function verifyModsInstallation() {
    try {
        // Load the mods list from mods.json
        const modsListPath = path.join(__dirname, 'mods.json'); 
        const modsList = JSON.parse(fs.readFileSync(modsListPath, 'utf-8'));

        // Path to the mods folder
        const modsDir = path.join(GAME_PATH, 'mods');
        if (!fs.existsSync(modsDir)) {
            return false; 
        }

        // Vérifier que chaque mod de la liste est présent
        for (const modUrl of modsList) {
            const fileName = modUrl.split('/').pop(); 
            const modFilePath = path.join(modsDir, fileName);
            if (!fs.existsSync(modFilePath)) {
                return false;
            }
            // Optional: If you also want a hash check, compute file hash here
        }

        // Tous les mods nécessaires sont là
        return true;
    } catch (error) {
        console.error('Erreur lors de la vérification des mods:', error);
        return false;
    }
}

// Modification de la fonction launchMinecraft pour suivre la documentation
async function launchMinecraft(event, options) {
    try {
        // Configuration des options de lancement selon la documentation
        const opts = {
            clientPackage: null,
            authorization: store.get('minecraft-token'),
            root: GAME_PATH,
            version: {
                number: "1.21",
                type: "release",
                custom: FABRIC_VERSION_LAUNCHER // Ajout de la version Fabric
            },
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

        // Lancement du jeu
        await launcher.launch(opts);
        
        gameRunning = true;
        mainWindow.minimize();

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

ipcMain.handle('launch-minecraft', async (event, options) => {
    try {
        // Vérifier l'authentification
        const savedToken = store.get('minecraft-token');
        if (!savedToken) {
            throw new Error('Veuillez vous connecter avec votre compte Microsoft');
        }

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
                message: 'Installation de Fabric nécessaire...'
            });
            await downloadFabric(event);
            await installFabric(event);
        }

        // Vérifier les mods
        const modsValid = await checkFileIntegrity(event);
        if (!modsValid) {
            event.sender.send('install-progress', {
                stage: 'verifying-mods',
                message: 'Vérification des mods...'
            });
            const retryValid = await checkFileIntegrity(event);
            if (!retryValid) {
                throw new Error('Impossible de réparer les mods');
            }
        }

        // Vérifier les ressources (resource packs et shaders)
        const resourcesValid = await resourceManager.verifyResources();
        if (!resourcesValid) {
            event.sender.send('install-progress', {
                stage: 'installing-resources',
                message: 'Installation des ressources...'
            });
            
            // Charger et installer les ressources depuis la configuration
            const resourcesConfig = JSON.parse(await fs.readFile(path.join(process.cwd(), 'resources.json'), 'utf8'));
            
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
        }

        // Lancer le jeu
        return await launchMinecraft(event, options);
    } catch (error) {
        console.error('Erreur lors du lancement:', error);
        return { success: false, error: error.message };
    }
});

// Ajoutez ces nouvelles fonctions d'initialisation
async function verifyGameFiles() {
    const gameFiles = [
        { path: GAME_PATH, type: 'directory' },
        { path: path.join(GAME_PATH, 'versions'), type: 'directory' },
        { path: path.join(GAME_PATH, 'assets'), type: 'directory' },
        { path: path.join(GAME_PATH, 'libraries'), type: 'directory' },
        { path: path.join(GAME_PATH, 'resourcepacks'), type: 'directory' },
        { path: path.join(GAME_PATH, 'shaderpacks'), type: 'directory' }
    ];

    for (const file of gameFiles) {
        if (file.type === 'directory' && !fs.existsSync(file.path)) {
            await fs.mkdir(file.path, { recursive: true });
        }
    }
}

async function loadConfigurations() {
    // Chargement des configurations
    const configs = {
        'java-path': javaPath,
        'game-directory': GAME_PATH,
        'fabric-version': FABRIC_VERSION,
        'minecraft-version': '1.21'
    };

    Object.entries(configs).forEach(([key, value]) => {
        if (!store.has(key)) {
            store.set(key, value);
        }
    });
}

// Modification de la fonction pour tuer le processus Minecraft
async function killMinecraftProcess() {
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

// Ajoutez les gestionnaires IPC pour les actions de sécurité
ipcMain.on('show-security-details', async (event) => {
    const reportPath = await securityChecker.generateReport();
    shell.openPath(reportPath);
});

ipcMain.on('remove-suspicious-files', async (event) => {
    const files = Array.from(securityChecker.suspiciousFiles.keys());
    for (const filePath of files) {
        await securityChecker.removeFile(filePath);
    }
    event.sender.close();
});