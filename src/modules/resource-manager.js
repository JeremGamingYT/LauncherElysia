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
        await fs.ensureDir(this.resourcepacksPath);
        await fs.ensureDir(this.shadersPath);
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
            await this.initialize();

            const resourcesConfig = path.join(process.cwd(), 'resources.json');
            if (!fs.existsSync(resourcesConfig)) {
                return true;
            }

            const config = JSON.parse(await fs.readFile(resourcesConfig, 'utf8'));
            
            // Vérifier les resource packs configurés
            for (const pack of config.resourcepacks || []) {
                const packPath = path.join(this.resourcepacksPath, path.basename(pack.url));
                const verification = await this.verifyFile(pack.url, packPath);
                if (!verification.exists || verification.needsUpdate) {
                    return false;
                }
            }

            // Vérifier les shaders configurés
            for (const shader of config.shaders || []) {
                const shaderPath = path.join(this.shadersPath, path.basename(shader.url));
                const verification = await this.verifyFile(shader.url, shaderPath);
                if (!verification.exists || verification.needsUpdate) {
                    return false;
                }
            }

            // Détecter les fichiers non configurés
            const configuredResourcePacks = new Set(config.resourcepacks.map(pack => path.basename(pack.url)));
            const configuredShaders = new Set(config.shaders.map(shader => path.basename(shader.url)));

            // Vérifier les resource packs non configurés
            const existingResourcePacks = await fs.readdir(this.resourcepacksPath);
            for (const pack of existingResourcePacks) {
                if (!configuredResourcePacks.has(pack)) {
                    console.log(`Pack de ressources non configuré détecté: ${pack}`);
                }
            }

            // Vérifier les shaders non configurés
            const existingShaders = await fs.readdir(this.shadersPath);
            for (const shader of existingShaders) {
                if (!configuredShaders.has(shader)) {
                    console.log(`Shader non configuré détecté: ${shader}`);
                }
            }

            return true;
        } catch (error) {
            console.error('Erreur lors de la vérification des ressources:', error);
            return false;
        }
    }
}

module.exports = ResourceManager; 