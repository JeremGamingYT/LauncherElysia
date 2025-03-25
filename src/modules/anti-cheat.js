const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const { app } = require('electron');
const os = require('os');
const { exec } = require('child_process');
const Store = require('electron-store');

class AntiCheat {
  constructor(gamePath) {
    this.gamePath = gamePath;
    this.modsFolderPath = path.join(gamePath, 'mods');
    this.resourcePacksPath = path.join(gamePath, 'resourcepacks');
    this.shadersPath = path.join(gamePath, 'shaderpacks');
    this.knownHashes = {};
    this.store = new Store();
    
    this.suspectMods = [
      'wurst', 'xray', 'cheat', 'hack', 'autoclicker', 'autoclick',
      'noclip', 'flymod', 'freecam', 'baritone', 'autofarm',
      'killaura', 'fulbright', 'fullbright', 'impact'
    ];
    
    this.suspectTexturePacks = [
      'xray', 'cheat', 'hack', 'wallhack', 'esp', 'fullbright'
    ];
    
    this.suspectShaders = [
      'xray', 'wallhack', 'esp', 'cheat', 'hack'
    ];
    
    // Configuration directe du webhook Discord dans le code
    this.webhookUrl = "https://discord.com/api/webhooks/1353904859153432596/qEzS5sb6H9LVzHCiHJP7_s7hhou584xlOI6TV2gOK_eiWSbh25z-c6b58qX9tjY9bfZ6"; // Remplacez par votre URL webhook
    this.serverName = "Elysia";
    this.initialized = true;
  }

  // Méthode pour initialiser l'anti-cheat (conservée pour compatibilité)
  initialize(serverName = "Elysia") {
    this.serverName = serverName;
    return this;
  }

  // Analyser les processus en cours d'exécution pour détecter des applications de triche connues
  async scanProcesses() {
    return new Promise((resolve) => {
      const suspectProcesses = [
        'AutoClicker', 'Wurst', 'Impact', 'Aristois', 'Baritone',
        'CheatBreaker', 'XRay', 'NoClip', 'Hacker', 'MCCheats'
      ];
      
      let command = '';
      if (process.platform === 'win32') {
        command = 'tasklist';
      } else if (process.platform === 'darwin') {
        command = 'ps -ax';
      } else {
        command = 'ps -e';
      }

      exec(command, (error, stdout) => {
        if (error) {
          resolve({ detected: false, details: [] });
          return;
        }

        const output = stdout.toLowerCase();
        const detectedProcesses = [];

        suspectProcesses.forEach(proc => {
          if (output.includes(proc.toLowerCase())) {
            detectedProcesses.push(proc);
          }
        });

        resolve({
          detected: detectedProcesses.length > 0,
          details: detectedProcesses
        });
      });
    });
  }

  // Analyser les fichiers de mods pour détecter des mods de triche
  async scanMods() {
    try {
      if (!fs.existsSync(this.modsFolderPath)) {
        return { detected: false, details: [] };
      }

      const files = await fs.readdir(this.modsFolderPath);
      const suspectMods = [];

      for (const file of files) {
        if (path.extname(file) === '.jar') {
          // Vérification par nom
          const lowerFileName = file.toLowerCase();
          for (const suspectTerm of this.suspectMods) {
            if (lowerFileName.includes(suspectTerm)) {
              suspectMods.push({ name: file, reason: 'suspicious_name' });
              break;
            }
          }
        }
      }

      return {
        detected: suspectMods.length > 0,
        details: suspectMods
      };
    } catch (error) {
      console.error('Error scanning mods:', error);
      return { detected: false, details: [] };
    }
  }
  
  // Analyser les packs de ressources pour détecter des packs de triche
  async scanResourcePacks() {
    try {
      if (!fs.existsSync(this.resourcePacksPath)) {
        return { detected: false, details: [] };
      }

      const files = await fs.readdir(this.resourcePacksPath);
      const suspectPacks = [];

      for (const file of files) {
        // Vérification des fichiers zip ou dossiers
        const filePath = path.join(this.resourcePacksPath, file);
        const isDirectory = fs.statSync(filePath).isDirectory();
        const fileExt = path.extname(file);
        
        if (isDirectory || fileExt === '.zip' || fileExt === '.mcpack') {
          const lowerFileName = file.toLowerCase();
          for (const suspectTerm of this.suspectTexturePacks) {
            if (lowerFileName.includes(suspectTerm)) {
              suspectPacks.push({ name: file, reason: 'suspicious_name' });
              break;
            }
          }
        }
      }

      return {
        detected: suspectPacks.length > 0,
        details: suspectPacks
      };
    } catch (error) {
      console.error('Error scanning resource packs:', error);
      return { detected: false, details: [] };
    }
  }
  
  // Analyser les shaders pour détecter des shaders de triche
  async scanShaders() {
    try {
      if (!fs.existsSync(this.shadersPath)) {
        return { detected: false, details: [] };
      }

      const files = await fs.readdir(this.shadersPath);
      const suspectShaders = [];

      for (const file of files) {
        // Vérification des fichiers zip ou dossiers
        const filePath = path.join(this.shadersPath, file);
        const isDirectory = fs.statSync(filePath).isDirectory();
        const fileExt = path.extname(file);
        
        if (isDirectory || fileExt === '.zip') {
          const lowerFileName = file.toLowerCase();
          for (const suspectTerm of this.suspectShaders) {
            if (lowerFileName.includes(suspectTerm)) {
              suspectShaders.push({ name: file, reason: 'suspicious_name' });
              break;
            }
          }
        }
      }

      return {
        detected: suspectShaders.length > 0,
        details: suspectShaders
      };
    } catch (error) {
      console.error('Error scanning shaders:', error);
      return { detected: false, details: [] };
    }
  }

  // Vérifiez les modifications système suspectes (hooks, DLL injectées, etc.)
  async scanSystemModifications() {
    // Cette fonction est plus complexe et varie grandement selon l'OS
    // Implémentation simple pour Windows
    if (process.platform === 'win32') {
      return new Promise((resolve) => {
        exec('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"', (error, stdout) => {
          if (error) {
            resolve({ detected: false, details: [] });
            return;
          }

          const suspectStartups = [];
          const output = stdout.toLowerCase();
          
          // Vérifiez les programmes suspect au démarrage
          for (const suspectTerm of this.suspectMods) {
            if (output.includes(suspectTerm)) {
              suspectStartups.push(suspectTerm);
            }
          }

          resolve({
            detected: suspectStartups.length > 0,
            details: suspectStartups
          });
        });
      });
    }
    
    return { detected: false, details: [] };
  }

  // Alerter via Discord Webhook
  async sendDiscordAlert(detectionType, details) {
    if (!this.initialized || !this.webhookUrl) {
      console.error('Anti-cheat not properly initialized with Discord webhook URL');
      return false;
    }

    try {
      // Récupérer le nom du joueur Minecraft à partir du profil stocké
      const minecraftProfile = this.store.get('minecraft-profile', null);
      const playerName = minecraftProfile && minecraftProfile.name ? minecraftProfile.name : os.userInfo().username;
      
      const playerInfo = {
        username: playerName,
        hostname: os.hostname(),
        platform: os.platform(),
        release: os.release()
      };

      const embed = {
        title: `🚨 Détection de triche`,
        color: 0xFF0000,
        fields: [
          {
            name: 'Serveur',
            value: this.serverName,
            inline: true
          },
          {
            name: 'Joueur',
            value: playerInfo.username,
            inline: true
          },
          {
            name: 'Type de détection',
            value: detectionType,
            inline: true
          },
          {
            name: 'Détails',
            value: Array.isArray(details) && details.length > 0 
              ? details.map(d => typeof d === 'string' ? d : JSON.stringify(d)).join(', ')
              : 'Aucun détail disponible'
          },
          {
            name: 'Système',
            value: `${playerInfo.platform} ${playerInfo.release}`
          },
          {
            name: 'Date',
            value: new Date().toLocaleString()
          }
        ],
        footer: {
          text: 'Système Anti-cheat Elysia'
        }
      };

      const payload = {
        embeds: [embed],
        username: 'Elysia Anti-Cheat',
        avatar_url: 'https://elysia.fr/logo.png' // Remplacez par l'URL de votre logo
      };

      const response = await axios.post(this.webhookUrl, payload);
      return response.status === 204;
    } catch (error) {
      console.error('Error sending Discord alert:', error);
      return false;
    }
  }

  // Lancer une analyse complète
  async runFullScan() {
    const results = {
      processesDetection: await this.scanProcesses(),
      modsDetection: await this.scanMods(),
      resourcePacksDetection: await this.scanResourcePacks(),
      shadersDetection: await this.scanShaders(),
      systemDetection: await this.scanSystemModifications(),
      timestamp: new Date().toISOString()
    };

    const detectionFound = 
      results.processesDetection.detected || 
      results.modsDetection.detected ||
      results.resourcePacksDetection.detected ||
      results.shadersDetection.detected ||
      results.systemDetection.detected;

    if (detectionFound && this.webhookUrl) {
      const detections = [];
      
      if (results.processesDetection.detected) {
        detections.push(`Processus suspects: ${results.processesDetection.details.join(', ')}`);
      }
      
      if (results.modsDetection.detected) {
        detections.push(`Mods suspects: ${results.modsDetection.details.map(m => m.name).join(', ')}`);
      }
      
      if (results.resourcePacksDetection.detected) {
        detections.push(`Packs de ressources suspects: ${results.resourcePacksDetection.details.map(p => p.name).join(', ')}`);
      }
      
      if (results.shadersDetection.detected) {
        detections.push(`Shaders suspects: ${results.shadersDetection.details.map(s => s.name).join(', ')}`);
      }
      
      if (results.systemDetection.detected) {
        detections.push(`Modifications système: ${results.systemDetection.details.join(', ')}`);
      }
      
      await this.sendDiscordAlert('Multiple detections', detections);
    }

    return {
      detectionFound,
      results
    };
  }
}

module.exports = AntiCheat;