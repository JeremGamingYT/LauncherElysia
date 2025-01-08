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
const FORGE_VERSION = '1.20.1-47.2.20';
const FORGE_VERSION_LAUNCHER = '1.20.1-forge-47.2.20';
const FORGE_INSTALLER_URL = `https://maven.minecraftforge.net/net/minecraftforge/forge/${FORGE_VERSION}/forge-${FORGE_VERSION}-installer.jar`;
const FORGE_INSTALLER_PATH = path.join(app.getPath('temp'), `forge-${FORGE_VERSION}-installer.jar`);

const tempDir = path.join(app.getPath('temp')); // Récupère le dossier Temp
const forgeInstallerName = 'forge-1.20.1-47.2.20-installer.jar'; // Nom du fichier
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
        versions: ['Beta'],
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
    try {
        // Vérifier l'installation de Minecraft
        const minecraftValid = await verifyMinecraftInstallation();
        if (!minecraftValid) {
            event.sender.send('install-progress', { stage: 'installing-minecraft', message: 'Installation de Minecraft...' });
            await installVanilla(event);
        } else {
            console.log('Minecraft is already installed, skipping reinstallation.');
        }

        // Vérifier l'installation de Forge
        const forgeValid = await verifyForgeInstallation();
        if (!forgeValid) {
            event.sender.send('install-progress', { stage: 'installing-forge', message: 'Installation de Forge...' });
            await downloadForge(event);
            await installForge(event);
        } else {
            console.log('Forge is already installed, skipping reinstallation.');
        }

        // Vérifier l'installation des mods
        const modsValid = await verifyModsInstallation();
        if (!modsValid) {
            event.sender.send('install-progress', { stage: 'installing-mods', message: 'Installation des mods...' });
            await installMods(event);
        } else {
            console.log('Mods are already installed and up to date, skipping reinstallation.');
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

// Fonction pour vérifier l'installation de Forge
async function verifyForgeInstallation() {
    try {
        // Vérifier les fichiers de version Forge
        const forgeVersionPath = path.join(GAME_PATH, 'versions', FORGE_VERSION_LAUNCHER);
        const forgeLibPath = path.join(GAME_PATH, 'libraries', 'net', 'minecraftforge', 'forge', FORGE_VERSION);
        
        // Liste complète des fichiers requis
        const requiredFiles = [
            // Fichiers de version
            path.join(forgeVersionPath, `${FORGE_VERSION_LAUNCHER}.json`),
            // Fichiers de bibliothèque
            path.join(forgeLibPath, `forge-${FORGE_VERSION}-universal.jar`),
            path.join(forgeLibPath, `forge-${FORGE_VERSION}-client.jar`)
        ];

        // Vérifier l'existence de tous les fichiers requis
        for (const file of requiredFiles) {
            if (!await fs.pathExists(file)) {
                console.log(`Fichier Forge manquant: ${file}`);
                return false;
            }
            
            // Vérifier que les fichiers ne sont pas vides
            const stats = await fs.stat(file);
            if (stats.size === 0) {
                console.log(`Fichier Forge corrompu (taille 0): ${file}`);
                return false;
            }
        }

        return true;
    } catch (error) {
        console.error('Erreur lors de la vérification de Forge:', error);
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

// Mise à jour du handler de lancement
ipcMain.handle('launch-minecraft', async (event, options) => {
    try {
        // Vérifier l'authentification
        const savedToken = store.get('minecraft-token');
        if (!savedToken) {
            throw new Error('Veuillez vous connecter avec votre compte Microsoft');
        }

        // Partie 1: Vérification des installations
        // Vérifier l'installation de Minecraft
        const minecraftValid = await verifyMinecraftInstallation();
        if (!minecraftValid) {
            event.sender.send('install-progress', {
                stage: 'installing-minecraft',
                message: 'Installation de Minecraft nécessaire...'
            });
            await installVanilla(event);
        }

        // Vérifier l'installation de Forge
        const forgeValid = await verifyForgeInstallation();
        if (!forgeValid) {
            event.sender.send('install-progress', {
                stage: 'installing-forge',
                message: 'Installation de Forge nécessaire...'
            });
            await downloadForge(event);
            await installForge(event);
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

        // Partie 2: Logique de lancement
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
            },
            overrides: {
                detached: false,
                stdio: 'pipe'
            },
            hideWindow: true
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
        await fs.access(path.join(GAME_PATH, 'versions', `${FORGE_VERSION_LAUNCHER}`));
        gameInstalled = true;
        store.set('gameInstalled', true);
        return { installed: true };
    } catch (error) {
        gameInstalled = false;
        store.set('gameInstalled', false);
        return { installed: false };
    }
}); 