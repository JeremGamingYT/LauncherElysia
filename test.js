const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs-extra')
const { exec } = require('child_process')
const axios = require('axios')
const { Client, Authenticator } = require('minecraft-launcher-core')
const progress = require('progress-stream')
const Store = require('electron-store')
const msmc = require('msmc')

const crypto = require('crypto');  // Pour générer des checksums
const os = require('os');

const store = new Store()
let mainWindow
let authData
let gameRunning = false

// Discord 'Rich presence'
const RPC = require('discord-rpc');
const clientId = '1296879619563327498';

// Crée un client RPC
const rpc = new RPC.Client({ transport: 'ipc' });

async function verifyFiles(fileList, basePath) {
  for (const fileUrl of fileList) {
      const fileName = path.basename(fileUrl);  // Extrait le nom du fichier depuis l'URL
      const filePath = path.join(basePath, fileName);
      
      try {
          // Vérifie si le fichier existe
          await fs.access(filePath);
      } catch (error) {
          console.log(`Fichier manquant: ${fileName}, retéléchargement nécessaire.`);
          return false;
      }
  }

  return true;
}

async function checkFileIntegrity(event) {
  const modsList = await fs.readJson(path.join(__dirname, 'mods.json'));  // Charger la liste des mods
  const modsPath = path.join(app.getPath('appData'), '.elysia', 'mods');

  const modsValid = await verifyFiles(modsList, modsPath);
  return modsValid;
}

const GAME_PATH = path.join(app.getPath('appData'), '.elysia')
const FORGE_VERSION = '1.20.1-47.3.2'
const FORGE_INSTALLER_URL = `https://maven.minecraftforge.net/net/minecraftforge/forge/${FORGE_VERSION}/forge-${FORGE_VERSION}-installer.jar`
const FORGE_INSTALLER_PATH = path.join(app.getPath('temp'), `forge-${FORGE_VERSION}-installer.jar`)

ipcMain.handle('check-game-installation', async () => {
  const storedGameInstalled = store.get('gameInstalled', false);

  if (storedGameInstalled) {
      gameInstalled = true;
      return { installed: true };
  }

  try {
      await fs.access(path.join(GAME_PATH, 'versions', `1.20.1-forge-${FORGE_VERSION}`));
      gameInstalled = true;
      store.set('gameInstalled', true);  // Si les fichiers sont présents, sauvegarde l'état
      return { installed: true };
  } catch (error) {
      gameInstalled = false;
      store.set('gameInstalled', false);
      return { installed: false };
  }
});


// Obtenir la RAM totale du système
ipcMain.handle('get-system-memory', () => {
  const totalRamInGB = Math.floor(os.totalmem() / (1024 ** 3));
  return totalRamInGB;
});

ipcMain.handle('get-memory-setting', async () => {
  const memorySetting = store.get('memory.max', '4');
  return memorySetting;
});

ipcMain.handle('set-memory-setting', async (event, value) => {
  store.set('memory.max', value);
  return true;
});


ipcMain.handle('install-game', async (event) => {
  if (gameInstalled) {
      return { success: true, message: 'Le jeu est déjà installé.' }
  }

  try {
      await fs.ensureDir(GAME_PATH);
      await downloadForge(event);
      await installForge(event);
      await installMods(event);

      gameInstalled = true;
      store.set('gameInstalled', true);  // Sauvegarde l'état de l'installation

      return { success: true, message: 'Installation terminée avec succès.' }
  } catch (error) {
      console.error('Erreur lors de l\'installation:', error);
      return { success: false, message: error.message }
  }
});

async function downloadForge(event) {
  const writer = fs.createWriteStream(FORGE_INSTALLER_PATH)
  const response = await axios({
    url: FORGE_INSTALLER_URL,
    method: 'GET',
    responseType: 'stream'
  })

  const totalLength = response.headers['content-length']

  const progressStream = progress({
    length: totalLength,
    time: 100
  })

  progressStream.on('progress', (progressData) => {
    const percentage = Math.round(progressData.percentage)
    event.sender.send('download-progress', percentage)
  })

  response.data.pipe(progressStream).pipe(writer)

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

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

ipcMain.handle('logout', async () => {
  authData = null;
  store.delete('authData');  // Supprimer les informations d'authentification sauvegardées
  return { success: true };
});


// Initialise le client Discord RPC
rpc.on('ready', () => {
  console.log('Rich Presence activé');

  // Mettre à jour le statut de Rich Presence
  rpc.setActivity({
    details: 'Elysia Launcher',
    state: '...',
    startTimestamp: Date.now(),
    largeImageKey: 'logo_image_key',  // Clé d'image pour ton logo (configuré sur le portail Discord)
    largeImageText: 'Elysia Launcher',
    instance: false,
  });
});

// Connexion au client RPC Discord
rpc.login({ clientId }).catch(console.error);

ipcMain.on('force-quit', () => {
  app.quit(); // Ferme l'application quand le signal est reçu
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 700,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    frame: false,  // Supprime la barre de titre
    closable: true,
    alwaysOnTop: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'), // Utiliser le format approprié
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    
    show: false, // Ne pas montrer la fenêtre immédiatement
    transparent: true,  // Rendre la fenêtre transparente
  })

  mainWindow.setMenu(null)
  mainWindow.loadFile('index.html')

  // Animation d'ouverture douce
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.webContents.send('app-ready')
  })

  // Gestion de la fermeture
  mainWindow.on('close', (event) => {
    if (gameRunning) {
      event.preventDefault()
      mainWindow.webContents.send('confirm-close')
    }
  })
}

// Initialisation de l'application
app.whenReady().then(() => {
  createWindow()
  
  // Gestion du dock sur macOS
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Ajoutez ces variables globales après les existantes
let appData
const APP_DATA_PATH = path.join(__dirname, 'data', 'app-data.json')

// Ajoutez cette fonction après la création de la fenêtre
async function loadAppData() {
  try {
    await fs.ensureFile(APP_DATA_PATH)
    const data = await fs.readFile(APP_DATA_PATH, 'utf8')
  } catch (error) {
    console.error('Erreur lors du chargement des données:', error)
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Nouveaux IPC handlers
ipcMain.handle('force-quit', () => {
  gameRunning = false
  app.quit()
})

ipcMain.handle('minimize-launcher', () => {
  mainWindow.minimize()
})

ipcMain.handle('check-for-java', async () => {
  const javaPath = store.get('java.path', 'C:\\Program Files\\Java\\jdk-17\\bin\\javaw.exe')
  try {
    await fs.access(javaPath)
    return { exists: true, path: javaPath }
  } catch {
    return { exists: false, path: javaPath }
  }
})

ipcMain.handle('open-folder', (event, folderPath) => {
  const fullPath = path.join(app.getPath('appData'), '.elysia', folderPath)
  shell.openPath(fullPath)
})

// Modification du handler de login
ipcMain.handle('login', async (event) => {
  try {
      // Vérifier si les informations d'authentification existent déjà
      const storedAuthData = store.get('authData');
      if (storedAuthData) {
          authData = storedAuthData;
          return { success: true };
      }

      // Si aucune info n'est stockée, procéder à une nouvelle authentification
      authData = await authenticateWithMicrosoft();
      store.set('authData', authData); // Sauvegarder les informations
      store.set('last-login', new Date().toISOString());

      return { success: true };
  } catch (error) {
      console.error(error);
      return { success: false, message: error.message };
  }
});


// Ajout du handler pour vérifier l'authentification
ipcMain.handle('check-authentication', async () => {
  const storedAuthData = store.get('authData');
  if (storedAuthData) {
      authData = storedAuthData;
      return { authenticated: true };
  } else {
      return { authenticated: false };
  }
});


// Modification du handler de lancement
ipcMain.handle('launch-game', async (event) => {
  try {
      // Vérification des fichiers avant de lancer le jeu
      const filesValid = await checkFileIntegrity(event);
      
      if (!filesValid) {
          event.sender.send('install-play-message', { message: 'Des fichiers sont manquants ou corrompus, retéléchargement...' });
          await downloadForge(event);
          await installForge(event);
          await installMods(event);
      }

      await launchGame(authData);
      gameRunning = true;
      mainWindow.minimize();  // Minimise le launcher quand le jeu démarre
      return { success: true };
  } catch (error) {
      console.error(error);
      return { success: false, message: error.message };
  }
});

ipcMain.handle('get-news', async () => {
  await loadAppData()
  return appData.news
})

function authenticateWithMicrosoft() {
  return new Promise((resolve, reject) => {
    msmc.fastLaunch('electron', (update) => {
      console.log('MSMC Update:', update)
    }).then(result => {
      if (msmc.errorCheck(result)) {
        reject(new Error(`Erreur d'authentification Microsoft : ${result.reason}`))
        return
      }
      const auth = msmc.getMCLC().getAuth(result)
      resolve(auth)
    }).catch(error => {
      reject(error)
    })
  })
}

async function installMods(event) {
  const modsJsonPath = path.join(__dirname, 'mods.json');  // Chemin vers le fichier mods.json
  const modsDestPath = path.join(app.getPath('appData'), '.elysia', 'mods');

  try {
      await fs.ensureDir(modsDestPath);

      // Lire la liste des mods à partir du fichier mods.json
      const modsList = await fs.readJson(modsJsonPath);
      const totalMods = modsList.length;
      let installedMods = 0;

      for (const modUrl of modsList) {
          const modName = path.basename(modUrl);  // Extraire le nom du fichier à partir de l'URL
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
  }
}

// Fonction améliorée de lancement du jeu
function launchGame(auth) {
  if (!gameInstalled) {
    throw new Error('Le jeu n\'est pas installé. Veuillez l\'installer d\'abord.')
  }
  const launcher = new Client()
  const gamePath = path.join(app.getPath('appData'), '.elysia')
  const maxMemory = parseInt(store.get('memory.max', '4'))
  const javaPath = store.get('java.path', 'C:\\Program Files\\Java\\jdk-17\\bin\\javaw.exe')
  
  // Ajoutez ces variables pour le tracking
  const sessionStart = new Date()
  let sessionDuration = 0

  const tempDir = path.join(app.getPath('temp')); // Récupère le dossier Temp
  const forgeInstallerName = 'forge-1.20.1-47.3.2-installer.jar'; // Nom du fichier
  const forgePath = path.join(tempDir, forgeInstallerName); // Combine le chemin et le nom du fichier


  rpc.setActivity({
    details: 'Elysia Launcher',
    state: 'Lancement du jeu...',
    startTimestamp: Date.now(),
    largeImageKey: 'install_image_key',  // Image clé que tu as configurée dans Discord
    largeImageText: 'Elysia Launcher',
    instance: false,
  });


  const opts = {
    authorization: auth,
    root: GAME_PATH,
    version: {
      number: '1.20.1',
      type: 'release'
    },
    javaPath: javaPath,
    forge: forgePath,
    memory: {
      max: `${maxMemory}G`,
      min: '2G'
    }
  }
  launcher.launch(opts)

  launcher.on('debug', (e) => console.log('Debug:', e))
  launcher.on('data', (e) => console.log('Data:', e))

  launcher.on('progress', (e) => {
    if (e.type === 'download') {
      const progressPercent = Math.round((e.task / e.total) * 100)
      mainWindow.webContents.send('download-progress', progressPercent)
    }
  })

  launcher.on('data', (e) => {
    // Lorsque Minecraft est en cours d'exécution
    rpc.setActivity({
      details: 'Élysia | En jeu',
      state: 'En train de jouer à Élysia',
      largeImageKey: 'elysia_playing',  // Image du logo ou du jeu
      largeImageText: 'Elysia',
      instance: false,
    });
  });  
  
  launcher.on('progress', (e) => {
    if (e.total > 0) {
      const progressPercent = Math.round((e.task / e.total) * 100)
      mainWindow.webContents.send('download-progress', progressPercent)
    }
  })

  launcher.on('close', async () => {
    gameRunning = false
    console.log('Minecraft closed')

    launcher.on('error', (error) => {
      gameRunning = false
      console.error('[Launcher Error]', error)
      mainWindow.webContents.send('launch-error', error.message)
    })
  })
}

// Fonction utilitaire pour vérifier l'espace disque
async function checkDiskSpace(path) {
  if (process.platform === 'win32') {
    return new Promise((resolve, reject) => {
      exec('wmic logicaldisk get size,freespace,caption', (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        const drive = path.split(':')[0] + ':'
        const lines = stdout.trim().split('\n')
        const values = lines[1].trim().split(/\s+/)
        resolve({
          free: parseInt(values[1]),
          size: parseInt(values[2])
        })
      })
    })
  } else {
    // Pour Linux/MacOS
    return new Promise((resolve, reject) => {
      exec(`df -k "${path}"`, (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        const lines = stdout.trim().split('\n')
        const values = lines[1].trim().split(/\s+/)
        resolve({
          free: parseInt(values[3]) * 1024,
          size: parseInt(values[1]) * 1024
        })
      })
    })
  }
}
