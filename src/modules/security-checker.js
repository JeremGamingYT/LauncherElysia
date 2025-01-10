const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const axios = require('axios');

class SecurityChecker extends EventEmitter {
    constructor(gamePath) {
        super();
        this.gamePath = gamePath;
        this.rules = require('./default-rules.json');
        this.detectionLog = path.join(gamePath, 'security', 'detections.log');
        this.suspiciousFiles = new Map();
        
        // Créer les dossiers nécessaires
        fs.ensureDirSync(path.join(gamePath, 'security'));
        fs.ensureDirSync(path.join(gamePath, 'security', 'quarantine'));
    }

    async initialize() {
        try {
            // Effectuer un scan initial des dossiers existants
            await this.initialScan();
            
            // Démarrer la surveillance des dossiers
            this.watchDirectories();
            
            console.log('Security Checker initialized');
            return true;
        } catch (error) {
            console.error('Error initializing SecurityChecker:', error);
            return false;
        }
    }

    // Nouvelle méthode pour le scan initial
    async initialScan() {
        const dirsToScan = [
            path.join(this.gamePath, 'mods'),
            path.join(this.gamePath, 'resourcepacks'),
            path.join(this.gamePath, 'shaderpacks'),
            path.join(this.gamePath, 'config')
        ];

        for (const dir of dirsToScan) {
            if (fs.existsSync(dir)) {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    const filePath = path.join(dir, file);
                    if ((await fs.stat(filePath)).isFile()) {
                        await this.scanFile(filePath);
                    }
                }
            }
        }
    }

    watchDirectories() {
        const dirsToWatch = [
            path.join(this.gamePath, 'mods'),
            path.join(this.gamePath, 'resourcepacks'),
            path.join(this.gamePath, 'shaderpacks'),
            path.join(this.gamePath, 'config')
        ];

        dirsToWatch.forEach(dir => {
            fs.ensureDirSync(dir);
            
            const watcher = fs.watch(dir, { persistent: true }, async (eventType, filename) => {
                if (!filename) return;

                const filePath = path.join(dir, filename);
                
                // Éviter les doublons et les fichiers temporaires
                if (filename.startsWith('.') || filename.endsWith('.tmp')) {
                    return;
                }

                // Attendre un court instant pour éviter les lectures partielles
                await new Promise(resolve => setTimeout(resolve, 100));

                try {
                    if (fs.existsSync(filePath)) {
                        await this.scanFile(filePath);
                    }
                } catch (error) {
                    console.error(`Erreur lors de la surveillance de ${filePath}:`, error);
                }
            });

            // Gérer les erreurs du watcher
            watcher.on('error', (error) => {
                console.error(`Erreur du watcher pour ${dir}:`, error);
                // Tenter de redémarrer le watcher
                setTimeout(() => this.watchDirectories(), 5000);
            });
        });
    }

    async scanFile(filePath) {
        try {
            const stats = await fs.stat(filePath);
            const fileBuffer = await fs.readFile(filePath);
            const fileName = path.basename(filePath);

            // Vérifier si le fichier est autorisé
            const isAuthorized = await this.isFileAuthorized(filePath);
            if (isAuthorized) {
                return; // Fichier autorisé, on ignore
            }

            const metadata = {
                name: fileName,
                path: filePath,
                size: stats.size,
                lastModified: stats.mtime
            };

            // Analyse du fichier
            const detections = await this.analyzeFile(fileBuffer, metadata);
            
            if (detections.length > 0) {
                console.log(`Détections pour ${fileName}:`, detections);
                this.handleDetection(metadata, detections);
            }
        } catch (error) {
            console.error(`Erreur lors de l'analyse de ${filePath}:`, error);
        }
    }

    async isFileAuthorized(filePath) {
        try {
            const fileName = path.basename(filePath);
            const fileDir = path.dirname(filePath);

            // Charger les listes de fichiers autorisés
            const modsListPath = path.join(__dirname, '..', 'mods.json');
            const resourcesListPath = path.join(__dirname, '..', 'resources.json');

            let modsList = [];
            let resourcesList = [];

            if (await fs.pathExists(modsListPath)) {
                modsList = await fs.readJson(modsListPath);
            }
            if (await fs.pathExists(resourcesListPath)) {
                const resources = await fs.readJson(resourcesListPath);
                resourcesList = [
                    ...(resources.resourcepacks || []),
                    ...(resources.shaders || [])
                ];
            }

            // Liste des extensions de fichiers de configuration légitimes
            const legitConfigExtensions = [
                '.toml',    // Fichiers de configuration Forge/Fabric
                '.json',    // Fichiers de configuration JSON
                '.cfg',     // Fichiers de configuration anciens mods
                '.conf',    // Fichiers de configuration alternatifs
                '.config', 
                '.properties'
            ];

            // Liste des dossiers de configuration légitimes
            const legitConfigDirs = [
                'config',
                'defaultconfigs',
                'saves',
                'schematics',
                'screenshots',
                'crash-reports',
                'logs'
            ];

            // Vérifier si c'est un fichier de configuration légitime
            if (fileDir.includes('config') || legitConfigDirs.some(dir => fileDir.includes(dir))) {
                // Si c'est une extension de fichier de configuration légitime
                if (legitConfigExtensions.some(ext => fileName.endsWith(ext))) {
                    return true;
                }
            }

            // Vérifier si le fichier est dans la liste des mods autorisés
            if (fileDir.includes('mods')) {
                // Vérifier le mod lui-même
                const isModAuthorized = modsList.some(mod => {
                    const modFileName = path.basename(mod);
                    return modFileName === fileName;
                });

                if (isModAuthorized) return true;

                // Vérifier si c'est un fichier de configuration associé à un mod autorisé
                const modName = fileName.split('-')[0].toLowerCase();
                const isAssociatedWithMod = modsList.some(mod => {
                    const modFileName = path.basename(mod).toLowerCase();
                    return modFileName.includes(modName);
                });

                if (isAssociatedWithMod && legitConfigExtensions.some(ext => fileName.endsWith(ext))) {
                    return true;
                }
            }

            // Vérifier si le fichier est dans la liste des ressources autorisées
            if (fileDir.includes('resourcepacks') || fileDir.includes('shaderpacks')) {
                return resourcesList.some(resource => {
                    const resourceFileName = path.basename(resource.url);
                    const resourceName = resource.name;
                    
                    // Vérifier le nom exact du fichier ou le nom de la ressource
                    return fileName === resourceFileName || 
                           fileName.includes(resourceName) ||
                           // Gérer les variations de noms (shaders)
                           (fileDir.includes('shaderpacks') && 
                            (fileName.toLowerCase().includes('shader') || 
                             fileName.toLowerCase().includes('seus') ||
                             fileName.toLowerCase().includes('bsl') ||
                             fileName.toLowerCase().includes('chocapic') ||
                             fileName.toLowerCase().includes('bliss')));
                });
            }

            // Vérifier les dossiers spéciaux qui devraient toujours être autorisés
            const alwaysAllowedDirs = [
                'assets',
                'libraries',
                'versions',
                'crash-reports',
                'logs',
                'saves'
            ];

            if (alwaysAllowedDirs.some(dir => fileDir.includes(dir))) {
                return true;
            }

            return false;
        } catch (error) {
            console.error('Erreur lors de la vérification d\'autorisation:', error);
            return false;
        }
    }

    async analyzeFile(buffer, metadata) {
        const detections = [];
        const fileName = metadata.name.toLowerCase();

        try {
            // 1. Vérification du nom de fichier
            for (const rule of this.rules.metadata) {
                if (rule.type === 'name') {
                    const pattern = new RegExp(rule.pattern, 'i');
                    if (pattern.test(fileName)) {
                        detections.push({
                            type: 'name_match',
                            confidence: rule.confidence,
                            description: rule.description
                        });
                    }
                }
            }

            // 2. Vérification du contenu
            const fileContent = buffer.toString('utf8');
            for (const signature of this.rules.signatures) {
                const pattern = new RegExp(signature.pattern, 'i');
                if (pattern.test(fileContent)) {
                    detections.push({
                        type: 'content_match',
                        confidence: signature.confidence,
                        description: signature.description
                    });
                }
            }

            // 3. Analyse spécifique selon le type de fichier
            if (fileName.endsWith('.zip') || fileName.endsWith('.jar')) {
                const hasXray = await this.analyzeArchiveForXray(buffer);
                if (hasXray) {
                    detections.push({
                        type: 'xray_detection',
                        confidence: 90,
                        description: 'Pack Xray détecté dans l\'archive'
                    });
                }
            }

            // 4. Vérification de la taille
            for (const rule of this.rules.metadata) {
                if (rule.type === 'size' && metadata.size > rule.maxSize) {
                    detections.push({
                        type: 'size_violation',
                        confidence: rule.confidence,
                        description: rule.description
                    });
                }
            }

            return detections;
        } catch (error) {
            console.error(`Erreur lors de l'analyse de ${metadata.name}:`, error);
            return detections;
        }
    }

    async detectXray(buffer, metadata) {
        try {
            // Vérification du nom de fichier
            const fileName = metadata.name.toLowerCase();
            const suspiciousNames = ['xray', 'x-ray', 'see through', 'transparent'];
            if (suspiciousNames.some(name => fileName.includes(name))) {
                return true;
            }

            // Vérification du contenu pour les fichiers texte
            if (metadata.name.endsWith('.txt') || metadata.name.endsWith('.json') || 
                metadata.name.endsWith('.properties') || metadata.name.endsWith('.cfg')) {
                const content = buffer.toString('utf8').toLowerCase();
                if (content.includes('xray') || content.includes('x-ray') || 
                    content.includes('see through') || content.includes('transparent ore')) {
                    return true;
                }
            }

            // Analyse des archives
            if (metadata.name.endsWith('.zip') || metadata.name.endsWith('.jar')) {
                return await this.analyzeArchiveForXray(buffer);
            }

            // Analyse des images
            if (metadata.name.endsWith('.png')) {
                return await this.analyzeTextureForXray(buffer);
            }

            return false;
        } catch (error) {
            console.error('Erreur lors de la détection Xray:', error);
            return false;
        }
    }

    async analyzeArchiveForXray(buffer) {
        try {
            const AdmZip = require('adm-zip');
            let zip;
            
            try {
                zip = new AdmZip(buffer);
            } catch (error) {
                console.log('Format d\'archive non supporté, analyse du contenu brut...');
                // Si l'archive ne peut pas être lue, on analyse son contenu brut
                const content = buffer.toString('utf8', 0, Math.min(buffer.length, 10000)); // Limiter à 10000 caractères
                return this.analyzeRawContent(content);
            }

            // Patterns spécifiques pour les textures Xray
            const suspiciousPatterns = [
                /transparent.*ore/i,
                /xray.*pack/i,
                /see.*through/i,
                /x-?ray/i
            ];

            try {
                const zipEntries = zip.getEntries();

                // Vérifier les noms de fichiers et leur contenu
                for (const entry of zipEntries) {
                    // Vérifier le nom du fichier
                    if (suspiciousPatterns.some(pattern => pattern.test(entry.entryName))) {
                        return true;
                    }

                    try {
                        // Vérifier les fichiers de configuration
                        if (entry.entryName.endsWith('.json') || 
                            entry.entryName.endsWith('.properties') || 
                            entry.entryName.endsWith('.txt') ||
                            entry.entryName.endsWith('.mcmeta')) {
                            const content = entry.getData().toString('utf8').toLowerCase();
                            if (content.includes('xray') || 
                                content.includes('x-ray') || 
                                content.includes('see through') ||
                                content.includes('transparent ore')) {
                                return true;
                            }
                        }

                        // Analyse des textures
                        if (entry.entryName.endsWith('.png')) {
                            try {
                                const imageBuffer = entry.getData();
                                if (await this.analyzeTextureForXray(imageBuffer)) {
                                    return true;
                                }
                            } catch (error) {
                                console.error('Erreur lors de l\'analyse de la texture:', error);
                            }
                        }
                    } catch (error) {
                        console.error(`Erreur lors de l'analyse de l'entrée ${entry.entryName}:`, error);
                        continue;
                    }
                }
            } catch (error) {
                console.error('Erreur lors de la lecture des entrées de l\'archive:', error);
            }

            return false;
        } catch (error) {
            console.error('Erreur lors de l\'analyse de l\'archive:', error);
            return false;
        }
    }

    // Nouvelle méthode pour analyser le contenu brut
    analyzeRawContent(content) {
        const suspiciousPatterns = [
            /xray/i,
            /x-ray/i,
            /see.?through/i,
            /transparent.?ore/i,
            /wallhack/i
        ];

        return suspiciousPatterns.some(pattern => pattern.test(content));
    }

    async analyzeTextureForXray(imageBuffer) {
        try {
            const sharp = require('sharp');
            const image = sharp(imageBuffer);
            const stats = await image.stats();
            
            // Vérifier la transparence moyenne
            const alphaChannel = stats.channels[3];
            if (alphaChannel && alphaChannel.mean < 0.5) {
                return true;
            }

            // Vérifier les motifs de couleur suspects
            const { dominant } = await image.stats();
            const suspiciousColors = [
                { r: 255, g: 0, b: 0 },    // Rouge pur
                { r: 0, g: 255, b: 0 },    // Vert pur
                { r: 0, g: 0, b: 255 }     // Bleu pur
            ];

            if (suspiciousColors.some(color => 
                Math.abs(color.r - dominant.r) < 10 &&
                Math.abs(color.g - dominant.g) < 10 &&
                Math.abs(color.b - dominant.b) < 10
            )) {
                return true;
            }

            return false;
        } catch (error) {
            console.error('Erreur lors de l\'analyse de la texture:', error);
            return false;
        }
    }

    evaluateMetadataRule(metadata, rule) {
        // Évaluation des règles basées sur les métadonnées
        switch (rule.type) {
            case 'size':
                return metadata.size > rule.maxSize;
            case 'name':
                return new RegExp(rule.pattern).test(metadata.name);
            case 'modification_time':
                return new Date(metadata.lastModified) < new Date(rule.minDate);
            default:
                return false;
        }
    }

    handleDetection(metadata, detections) {
        const detection = {
            timestamp: new Date().toISOString(),
            file: metadata,
            detections: detections,
            severity: this.calculateSeverity(detections)
        };

        // Générer un ID unique pour cette détection
        const detectionId = `${metadata.path}_${Date.now()}`;

        // Enregistrer la détection
        this.logDetection(detection);

        // Ajouter à la liste des fichiers suspects
        // Maintenant on stocke un tableau de détections pour chaque fichier
        if (!this.suspiciousFiles.has(metadata.path)) {
            this.suspiciousFiles.set(metadata.path, []);
        }
        this.suspiciousFiles.get(metadata.path).push({
            id: detectionId,
            ...detection
        });

        // Émettre l'événement pour l'interface utilisateur avec toutes les détections actives
        this.emit('detection', {
            newDetection: detection,
            allDetections: Array.from(this.suspiciousFiles.entries()).map(([path, detections]) => ({
                path,
                detections
            }))
        });

        // Actions automatiques basées sur la sévérité
        if (detection.severity >= 90) {
            this.quarantineFile(metadata.path);
        }
    }

    async logDetection(detection) {
        const logEntry = JSON.stringify({
            timestamp: detection.timestamp,
            file: detection.file.name,
            path: detection.file.path,
            detections: detection.detections
        }) + '\n';

        await fs.appendFile(this.detectionLog, logEntry);
    }

    async generateReport() {
        const allDetections = Array.from(this.suspiciousFiles.entries()).map(([path, detections]) => ({
            path,
            detections
        }));

        const report = {
            timestamp: new Date().toISOString(),
            totalFiles: this.suspiciousFiles.size,
            totalDetections: allDetections.reduce((acc, curr) => acc + curr.detections.length, 0),
            detections: allDetections
        };

        const reportPath = path.join(this.gamePath, 'security', `report-${Date.now()}.json`);
        await fs.writeJson(reportPath, report, { spaces: 2 });
        return reportPath;
    }

    async removeFile(filePath) {
        try {
            await fs.remove(filePath);
            // Supprimer toutes les détections associées à ce fichier
            this.suspiciousFiles.delete(filePath);
            return true;
        } catch (error) {
            console.error('Error removing file:', error);
            return false;
        }
    }

    calculateSeverity(detections) {
        let maxSeverity = 0;
        let cumulativeSeverity = 0;

        detections.forEach(detection => {
            const confidence = detection.confidence || 0;
            maxSeverity = Math.max(maxSeverity, confidence);
            cumulativeSeverity += confidence;
        });

        // Moyenne pondérée entre la sévérité maximale et la sévérité cumulative
        return Math.min(
            100,
            (maxSeverity * 0.7) + ((cumulativeSeverity / detections.length) * 0.3)
        );
    }

    async quarantineFile(filePath) {
        try {
            const quarantinePath = path.join(this.gamePath, 'security', 'quarantine');
            await fs.ensureDir(quarantinePath);

            const fileName = path.basename(filePath);
            const quarantineFile = path.join(quarantinePath, `${fileName}.quarantine`);

            // Créer un fichier de métadonnées pour la quarantaine
            const metadata = {
                originalPath: filePath,
                quarantineDate: new Date().toISOString(),
                detections: this.suspiciousFiles.get(filePath)
            };

            // Déplacer le fichier en quarantaine
            await fs.move(filePath, quarantineFile);
            await fs.writeJson(
                `${quarantineFile}.meta`,
                metadata,
                { spaces: 2 }
            );

            console.log(`Fichier mis en quarantaine: ${fileName}`);
        } catch (error) {
            console.error('Erreur lors de la mise en quarantaine:', error);
        }
    }
}

module.exports = SecurityChecker; 