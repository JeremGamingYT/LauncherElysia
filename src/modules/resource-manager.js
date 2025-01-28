const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const progress = require('progress-stream');
const crypto = require('crypto');

class ResourceManager {
    constructor(gamePath) {
        this.gamePath = gamePath;
        this.resourcepacksPath = path.join(gamePath, 'resourcepacks');
        this.shadersPath = path.join(gamePath, 'shaderpacks');
    }

    async initialize() {
        try {
            // Créer les dossiers avec vérification renforcée
            await fs.ensureDir(this.resourcepacksPath);
            await fs.ensureDir(this.shadersPath);
            
            // Vérifier que les dossiers sont bien accessibles
            const resourcepacksAccess = await fs.access(this.resourcepacksPath, fs.constants.W_OK);
            const shadersAccess = await fs.access(this.shadersPath, fs.constants.W_OK);
            
            console.log('Dossiers ressources initialisés avec succès');
            return true;
        } catch (error) {
            console.error('Erreur lors de l\'initialisation des dossiers:', error);
            throw new Error('Impossible de créer les dossiers nécessaires');
        }
    }

    // Fonction pour calculer le hash d'un fichier
    async calculateFileHash(filePath) {
        try {
            const fileBuffer = await fs.readFile(filePath);
            const hashSum = crypto.createHash('sha256');
            hashSum.update(fileBuffer);
            return hashSum.digest('hex');
        } catch (error) {
            console.error('Erreur lors du calcul du hash:', error);
            return null;
        }
    }

    // Fonction pour vérifier un fichier spécifique
    async verifyFile(url, filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                return { exists: false, needsUpdate: true };
            }

            // Télécharger temporairement le fichier pour comparer les hash
            const tempPath = path.join(this.gamePath, 'temp_' + path.basename(filePath));
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream'
            });

            await new Promise((resolve, reject) => {
                response.data
                    .pipe(fs.createWriteStream(tempPath))
                    .on('finish', resolve)
                    .on('error', reject);
            });

            const originalHash = await this.calculateFileHash(filePath);
            const newHash = await this.calculateFileHash(tempPath);

            await fs.remove(tempPath);

            return {
                exists: true,
                needsUpdate: originalHash !== newHash
            };
        } catch (error) {
            console.error('Erreur lors de la vérification du fichier:', error);
            return { exists: false, needsUpdate: true };
        }
    }

    async installResourcePack(url, event) {
        try {
            const fileName = path.basename(url);
            const filePath = path.join(this.resourcepacksPath, fileName);
            
            // Vérifier si le fichier existe et s'il doit être mis à jour
            const verification = await this.verifyFile(url, filePath);
            if (verification.exists && !verification.needsUpdate) {
                console.log(`Le pack de ressources ${fileName} est déjà à jour`);
                return true;
            }

            event.sender.send('install-progress', {
                stage: 'installing-resourcepack',
                message: verification.exists ? 
                    `Mise à jour du pack de ressources: ${fileName}` :
                    `Installation du pack de ressources: ${fileName}`
            });

            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream'
            });

            const str = progress({
                length: parseInt(response.headers['content-length']),
                time: 100
            });

            str.on('progress', (progress) => {
                event.sender.send('install-progress', {
                    stage: 'resourcepack-progress',
                    progress: Math.round(progress.percentage),
                    message: `Téléchargement: ${fileName}`
                });
            });

            await new Promise((resolve, reject) => {
                response.data
                    .pipe(str)
                    .pipe(fs.createWriteStream(filePath))
                    .on('finish', resolve)
                    .on('error', reject);
            });

            return true;
        } catch (error) {
            console.error('Erreur lors de l\'installation du pack de ressources:', error);
            throw error;
        }
    }

    async installShader(url, event) {
        try {
            const fileName = path.basename(url);
            const filePath = path.join(this.shadersPath, fileName);
            
            const verification = await this.verifyFile(url, filePath);
            if (verification.exists && !verification.needsUpdate) {
                console.log(`Le shader ${fileName} est déjà à jour`);
                return true;
            }

            event.sender.send('install-progress', {
                stage: 'installing-shader',
                message: verification.exists ? 
                    `Mise à jour du shader: ${fileName}` :
                    `Installation du shader: ${fileName}`
            });

            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream'
            });

            const str = progress({
                length: parseInt(response.headers['content-length']),
                time: 100
            });

            str.on('progress', (progress) => {
                event.sender.send('install-progress', {
                    stage: 'shader-progress',
                    progress: Math.round(progress.percentage),
                    message: `Téléchargement: ${fileName}`
                });
            });

            await new Promise((resolve, reject) => {
                response.data
                    .pipe(str)
                    .pipe(fs.createWriteStream(filePath))
                    .on('finish', resolve)
                    .on('error', reject);
            });

            return true;
        } catch (error) {
            console.error('Erreur lors de l\'installation du shader:', error);
            throw error;
        }
    }

    async verifyResources() {
        try {
            // Vérifier seulement si le dossier existe et contient des fichiers
            const resourcepacksExist = await fs.pathExists(this.resourcepacksPath) 
                && (await fs.readdir(this.resourcepacksPath)).length > 0;
            
            const shadersExist = await fs.pathExists(this.shadersPath) 
                && (await fs.readdir(this.shadersPath)).length > 0;

            return resourcepacksExist && shadersExist;
        } catch (error) {
            console.error('Erreur vérification ressources:', error);
            return false;
        }
    }

    async installMod(url, event) {
        const fileName = path.basename(new URL(url).pathname).toLowerCase();
        const destPath = path.join(this.gamePath, 'mods', fileName);
        
        if (!fs.existsSync(destPath)) {
            await this.downloadFile(url, destPath, event);
        }
    }
}

module.exports = ResourceManager; 