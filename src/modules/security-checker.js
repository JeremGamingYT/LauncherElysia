const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const axios = require('axios');

const UNSAFE_EXTENSIONS = ['.exe', '.jar', '.bat', '.cmd', '.ps1', '.vbs', '.dll'];
const IGNORED_DIRECTORIES = [
    'config',
    'defaultconfigs',
    'saves',
    'screenshots',
    'crash-reports',
    'logs'
];
const SUSPICIOUS_PATTERNS = {
    XRAY: {
        patterns: [
            /x-?ray/i,
            /see.?through/i,
            /transparent.?ore/i,
            /wallhack/i,
            /freecam/i,
            /noclip/i,
            /cavefinder/i,
            /fullbright/i,
            /night.?vision/i
        ],
        baseConfidence: 75
    },
    CHEAT: {
        patterns: [
            /hack/i,
            /cheat/i,
            /exploit/i,
            /bypass/i,
            /autoc?lick/i,
            /killaura/i,
            /speedhack/i,
            /blink/i,
            /phase/i,
            /fly/i,
            /nofall/i,
            /step/i,
            /reach/i,
            /aimbot/i,
            /triggerbot/i,
            /bhop/i,
            /booster/i,
            /velocity/i,
            /antiknockback/i,
            /criticals/i,
            /fastbreak/i,
            /fastplace/i,
            /scaffold/i,
            /timer/i,
            /esp/i,
            /trajectories/i,
            /autofish/i,
            /autotool/i,
            /freecam/i,
            /norender/i,
            /antiafk/i,
            /packet/i,
            /nuker/i,
            /xcarry/i,
            /entityspeed/i
        ],
        baseConfidence: 80
    },
    CRASH: {
        patterns: [
            /crash/i,
            /exploit/i,
            /overflow/i,
            /buffer/i,
            /dos/i,
            /ddos/i,
            /memory.?leak/i,
            /stack.?overflow/i,
            /heap.?overflow/i,
            /null.?pointer/i,
            /segmentation/i
        ],
        baseConfidence: 85
    },
    MALICIOUS: {
        patterns: [
            /backdoor/i,
            /rat/i,
            /trojan/i,
            /keylogger/i,
            /stealer/i,
            /grabber/i,
            /inject/i,
            /malware/i,
            /virus/i,
            /botnet/i,
            /rootkit/i,
            /spyware/i,
            /ransomware/i,
            /cryptominer/i,
            /token/i
        ],
        baseConfidence: 95
    }
};

const TEXTURE_ANALYSIS = {
    SUSPICIOUS_COLORS: [
        { r: 255, g: 0, b: 0 },    // Rouge pur
        { r: 0, g: 255, b: 0 },    // Vert pur
        { r: 0, g: 0, b: 255 },    // Bleu pur
        { r: 255, g: 255, b: 0 },  // Jaune pur
        { r: 0, g: 255, b: 255 }   // Cyan pur
    ],
    TRANSPARENCY_THRESHOLD: 0.4,
    COLOR_SIMILARITY_THRESHOLD: 15
};

const ADVANCED_DETECTION = {
    // Seuils pour l'analyse d'entropie
    ENTROPY_THRESHOLDS: {
        VERY_LOW: 2.0,
        LOW: 3.5,
        MEDIUM: 5.0,
        HIGH: 7.0
    },
    
    // Patterns pour l'analyse comportementale
    BEHAVIOR_PATTERNS: {
        OBFUSCATION: [
            /eval\(/i,
            /base64/i,
            /fromCharCode/i,
            /\\x[0-9a-f]{2}/i,
            /\\u[0-9a-f]{4}/i
        ],
        NETWORKING: [
            /http[s]?:\/\//i,
            /websocket/i,
            /fetch\(/i,
            /xhr/i
        ],
        SYSTEM_ACCESS: [
            /process\./i,
            /require\(/i,
            /exec\(/i,
            /spawn\(/i
        ]
    },
    
    // Seuils pour les modifications de fichiers
    TIME_THRESHOLDS: {
        RAPID_MODIFICATION: 5 * 60 * 1000, // 5 minutes
        SUSPICIOUS_CREATION: 24 * 60 * 60 * 1000 // 24 heures
    }
};

const METADATA_EXTRACTORS = {
    JAR: {
        manifest: /META-INF\/MANIFEST\.MF/i,
        modInfo: /fabric\.mod\.json|mods\.toml|mcmod\.info/i,
        config: /config\.json|configuration\.json|settings\.json/i
    },
    RESOURCEPACK: {
        packInfo: /pack\.mcmeta/i,
        credits: /credits\.txt|readme\.txt|authors\.txt/i
    }
};

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
            // Scan initial
            await this.initialScan();
            
            // Démarrer la surveillance des dossiers
            this.watchDirectories();
            
            // Vérification périodique des fichiers non autorisés
            setInterval(() => {
                this.checkUnauthorizedFiles();
            }, 5 * 60 * 1000); // Vérifier toutes les 5 minutes
            
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
            path.join(this.gamePath, 'shaderpacks')
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
            path.join(this.gamePath, 'shaderpacks')
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

                // Vérifier si le chemin contient un dossier ignoré
                if (IGNORED_DIRECTORIES.some(ignoredDir => filePath.includes(ignoredDir))) {
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
                lastModified: stats.mtime,
                created: stats.birthtime
            };

            // Collecter toutes les détections de différentes sources
            let allDetections = [];

            // 1. Analyse de base du fichier
            const basicDetections = await this.analyzeFile(fileBuffer, metadata);
            if (basicDetections && basicDetections.length > 0) {
                allDetections.push(...basicDetections);
            }

            // 2. Analyse avancée
            const advancedDetections = await this.performAdvancedAnalysis(fileBuffer, metadata);
            if (advancedDetections && advancedDetections.length > 0) {
                allDetections.push(...advancedDetections);
            }

            // 3. Analyse comportementale
            const behaviorDetections = await this.analyzeBehavior(filePath, metadata);
            if (behaviorDetections && behaviorDetections.length > 0) {
                allDetections.push(...behaviorDetections);
            }

            // 4. Analyse spécifique pour les archives
            if (fileName.endsWith('.zip') || fileName.endsWith('.jar')) {
                try {
                    const archiveDetections = await this.analyzeArchiveContent(fileBuffer, metadata);
                    if (archiveDetections && archiveDetections.length > 0) {
                        allDetections.push(...archiveDetections);
                    }
                } catch (error) {
                    console.error(`Erreur lors de l'analyse de l'archive ${fileName}:`, error);
                }
            }

            // 5. Vérification des fichiers non autorisés
            if (!isAuthorized) {
                allDetections.push({
                    type: 'unauthorized_file',
                    description: 'Fichier non autorisé détecté',
                    confidence: 90,
                    details: {
                        fileName: fileName,
                        path: filePath,
                        size: stats.size,
                        created: stats.birthtime,
                        modified: stats.mtime
                    }
                });
            }

            // Filtrer les détections uniques et valides
            const uniqueDetections = this.filterUniqueDetections(allDetections.filter(Boolean));
            
            if (uniqueDetections.length > 0) {
                console.log(`Détections pour ${fileName}:`, uniqueDetections);
                this.handleDetection(metadata, uniqueDetections);
            }
        } catch (error) {
            console.error(`Erreur lors de l'analyse de ${filePath}:`, error);
        }
    }

    async isFileAuthorized(filePath) {
        try {
            const fileName = path.basename(filePath);
            const fileDir = path.dirname(filePath);
            const normalizedFileName = this.normalizeFileName(fileName);

            // Charger les listes de fichiers autorisés
            const modsListPath = path.join(__dirname, '..', 'mods.json');
            const resourcesListPath = path.join(__dirname, '..', 'resources.json');

            let modsList = [];
            let resources = { resourcepacks: [], shaders: [] };

            if (await fs.pathExists(modsListPath)) {
                modsList = await fs.readJson(modsListPath);
            }
            if (await fs.pathExists(resourcesListPath)) {
                resources = await fs.readJson(resourcesListPath);
            }

            // Vérifier si c'est un fichier de configuration légitime
            if (fileDir.includes('config') || IGNORED_DIRECTORIES.some(dir => fileDir.includes(dir))) {
                return true;
            }

            // Vérifier si le fichier est dans la liste des mods autorisés
            if (fileDir.includes('mods')) {
                return modsList.some(mod => {
                    const modUrl = typeof mod === 'string' ? mod : mod.url;
                    if (!modUrl) return false;
                    const modFileName = path.basename(modUrl);
                    return this.normalizeFileName(modFileName) === normalizedFileName;
                });
            }

            // Vérifier les resource packs
            if (fileDir.includes('resourcepacks')) {
                return resources.resourcepacks.some(pack => {
                    if (!pack || !pack.url) return false;
                    const packFileName = path.basename(pack.url);
                    return this.normalizeFileName(packFileName) === normalizedFileName;
                });
            }

            // Vérifier les shaders
            if (fileDir.includes('shaderpacks')) {
                return resources.shaders.some(shader => {
                    if (!shader || !shader.url) return false;
                    const shaderFileName = path.basename(shader.url);
                    return this.normalizeFileName(shaderFileName) === normalizedFileName;
                });
            }

            return false;
        } catch (error) {
            console.error('Erreur lors de la vérification d\'autorisation:', error);
            return false;
        }
    }

    normalizeFileName(fileName) {
        if (!fileName) return '';
        return fileName
            .toLowerCase()
            .replace(/[\s_-]+/g, '') // Supprimer les espaces, tirets et underscores
            .replace(/[()[\]{}]/g, '') // Supprimer les parenthèses et crochets
            .replace(/v\d+(\.\d+)*[a-z]?/g, '') // Supprimer les numéros de version et lettres de version
            .replace(/\.(zip|jar)$/, '') // Supprimer l'extension
            .replace(/[^\w\d]/g, ''); // Supprimer tous les caractères spéciaux restants
    }

    async analyzeFile(buffer, metadata) {
        const detections = [];
        const fileName = metadata.name.toLowerCase();

        try {
            // 1. Vérification du nom de fichier
            for (const [category, data] of Object.entries(SUSPICIOUS_PATTERNS)) {
                for (const pattern of data.patterns) {
                    if (pattern.test(fileName)) {
                        detections.push({
                            type: `${category.toLowerCase()}_name`,
                            description: `Nom de fichier suspect (${category})`,
                            confidence: data.baseConfidence,
                            pattern: pattern.toString()
                        });
                    }
                }
            }

            // 2. Vérification du contenu
            const fileContent = buffer.toString('utf8');
            for (const [category, data] of Object.entries(SUSPICIOUS_PATTERNS)) {
                for (const pattern of data.patterns) {
                    if (pattern.test(fileContent)) {
                        detections.push({
                            type: `${category.toLowerCase()}_content`,
                            description: `Contenu suspect détecté (${category})`,
                            confidence: data.baseConfidence + 5,
                            pattern: pattern.toString()
                        });
                    }
                }
            }

            // 3. Analyse spécifique selon le type de fichier
            if (fileName.endsWith('.zip') || fileName.endsWith('.jar')) {
                const xrayDetections = await this.analyzeArchiveForXray(buffer);
                detections.push(...xrayDetections);
            }

            return detections;
        } catch (error) {
            console.error(`Erreur lors de l'analyse de ${metadata.name}:`, error);
            return detections;
        }
    }

    async analyzeArchiveForXray(buffer) {
        const detections = [];
        try {
            const AdmZip = require('adm-zip');
            let zip;
            
            try {
                zip = new AdmZip(buffer);
            } catch (error) {
                const rawContentDetection = this.analyzeRawContent(buffer.toString('utf8', 0, Math.min(buffer.length, 10000)));
                if (rawContentDetection) {
                    detections.push(rawContentDetection);
                }
                return detections;
            }

            const entries = zip.getEntries();

            // Vérifier chaque entrée de l'archive
            for (const entry of entries) {
                try {
                    // 1. Vérifier le nom de l'entrée
                    for (const [category, data] of Object.entries(SUSPICIOUS_PATTERNS)) {
                        for (const pattern of data.patterns) {
                            if (pattern.test(entry.entryName)) {
                                detections.push({
                                    type: `${category.toLowerCase()}_archive_name`,
                                    description: `Fichier suspect dans l'archive (${category})`,
                                    confidence: data.baseConfidence,
                                    file: entry.entryName
                                });
                            }
                        }
                    }

                    // 2. Vérifier le contenu de l'entrée
                    if (entry.entryName.endsWith('.json') || 
                        entry.entryName.endsWith('.txt') || 
                        entry.entryName.endsWith('.properties') ||
                        entry.entryName.endsWith('.mcmeta')) {
                        const content = entry.getData().toString('utf8');
                        
                        for (const [category, data] of Object.entries(SUSPICIOUS_PATTERNS)) {
                            for (const pattern of data.patterns) {
                                if (pattern.test(content)) {
                                    detections.push({
                                        type: `${category.toLowerCase()}_archive_content`,
                                        description: `Contenu suspect dans le fichier ${entry.entryName} (${category})`,
                                        confidence: data.baseConfidence + 5,
                                        file: entry.entryName
                                    });
                                }
                            }
                        }
                    }

                    // 3. Analyse des textures
                    if (entry.entryName.endsWith('.png')) {
                        try {
                            const imageBuffer = entry.getData();
                            const textureDetection = await this.analyzeTextureForXray(imageBuffer);
                            if (textureDetection) {
                                detections.push({
                                    ...textureDetection,
                                    file: entry.entryName
                                });
                            }
                        } catch (error) {
                            console.error(`Erreur lors de l'analyse de la texture ${entry.entryName}:`, error);
                        }
                    }
                } catch (error) {
                    console.error(`Erreur lors de l'analyse de l'entrée ${entry.entryName}:`, error);
                    continue;
                }
            }

        } catch (error) {
            console.error('Erreur lors de l\'analyse de l\'archive:', error);
        }

        return detections;
    }

    // Nouvelle méthode pour filtrer les détections uniques
    filterUniqueDetections(detections) {
        const seen = new Set();
        return detections.filter(detection => {
            const key = `${detection.type}_${detection.description}_${detection.confidence}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
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
            id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
            file: metadata,
            detections: detections,
            severity: this.calculateSeverity(detections)
        };

        // Enregistrer la détection
        this.logDetection(detection);

        // Ajouter à la liste des fichiers suspects
        if (!this.suspiciousFiles.has(metadata.path)) {
            this.suspiciousFiles.set(metadata.path, []);
        }
        this.suspiciousFiles.get(metadata.path).push(detection);

        // Émettre l'événement pour l'interface utilisateur
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

    async deepAnalyzeFile(filePath, buffer, metadata) {
        const detections = [];
        const fileType = await this.detectFileType(buffer);
        
        // Analyse basée sur le type de fichier
        switch (fileType.mime) {
            case 'image/png':
            case 'image/jpeg':
                const imageDetections = await this.analyzeImage(buffer);
                detections.push(...imageDetections);
                break;

            case 'text/plain':
            case 'text/json':
            case 'application/json':
            case 'text/xml':
                const textDetections = await this.analyzeTextContent(buffer.toString());
                detections.push(...textDetections);
                break;

            case 'application/zip':
            case 'application/x-zip-compressed':
                if (!UNSAFE_EXTENSIONS.some(ext => metadata.name.endsWith(ext))) {
                    const zipDetections = await this.analyzeZipContent(buffer);
                    detections.push(...zipDetections);
                }
                break;
        }

        // Analyse comportementale
        const behaviorDetections = await this.analyzeBehavior(filePath, metadata);
        detections.push(...behaviorDetections);

        return this.calculateRealConfidence(detections, metadata);
    }

    async analyzeImage(buffer) {
        const detections = [];
        try {
            const sharp = require('sharp');
            const image = sharp(buffer);
            const metadata = await image.metadata();
            const stats = await image.stats();

            // Analyse de transparence suspecte
            if (metadata.hasAlpha) {
                const alphaStats = stats.channels[3];
                if (alphaStats.mean < TEXTURE_ANALYSIS.TRANSPARENCY_THRESHOLD) {
                    detections.push({
                        type: 'suspicious_transparency',
                        description: 'Texture avec transparence suspecte',
                        confidence: this.calculateImageConfidence(alphaStats)
                    });
                }
            }

            // Analyse des couleurs
            const { dominant } = stats;
            const hasUniformColor = stats.channels.every(channel => 
                channel.stdev < 10 && (channel.mean < 0.1 || channel.mean > 0.9)
            );

            if (hasUniformColor) {
                detections.push({
                    type: 'uniform_color',
                    description: 'Texture uniformément transparente ou opaque',
                    confidence: 70
                });
            }

            // Analyse des motifs
            const { entropy } = await this.calculateImageEntropy(image);
            if (entropy < 2.0) { // Valeur seuil pour les textures trop simples
                detections.push({
                    type: 'low_entropy',
                    description: 'Texture suspectement simple',
                    confidence: 65
                });
            }

        } catch (error) {
            console.error('Erreur lors de l\'analyse de l\'image:', error);
        }
        return detections;
    }

    async analyzeTextContent(content) {
        const detections = [];
        const lines = content.split('\n');
        
        // Analyse ligne par ligne avec contexte
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].toLowerCase();
            const context = this.getLineContext(lines, i, 3); // 3 lignes avant et après

            for (const [category, data] of Object.entries(SUSPICIOUS_PATTERNS)) {
                for (const pattern of data.patterns) {
                    if (pattern.test(line)) {
                        const confidence = this.calculatePatternConfidence(
                            pattern,
                            line,
                            context,
                            data.baseConfidence
                        );
                        
                        if (confidence > 60) {
                            detections.push({
                                type: `suspicious_${category.toLowerCase()}`,
                                description: `Code suspect détecté (${category})`,
                                confidence,
                                context: context.join('\n')
                            });
                        }
                    }
                }
            }
        }

        return detections;
    }

    async analyzeBehavior(filePath, metadata) {
        const detections = [];
        
        // Vérification des modifications récentes
        const stats = await fs.stat(filePath);
        const modifiedTime = new Date(stats.mtime);
        const createdTime = new Date(stats.birthtime);
        
        // Vérifier si le fichier a été modifié après sa création
        if (modifiedTime > createdTime) {
            const timeDiff = modifiedTime - createdTime;
            if (timeDiff < 1000 * 60 * 5) { // 5 minutes
                detections.push({
                    type: 'rapid_modification',
                    description: 'Fichier modifié rapidement après sa création',
                    confidence: 70
                });
            }
        }

        // Vérification des permissions
        try {
            const perms = (await fs.stat(filePath)).mode;
            if ((perms & 0o777) === 0o777) { // Permissions trop permissives
                detections.push({
                    type: 'suspicious_permissions',
                    description: 'Permissions de fichier suspectes',
                    confidence: 65
                });
            }
        } catch (error) {
            console.error('Erreur lors de la vérification des permissions:', error);
        }

        // Vérification de l'intégrité par rapport aux fichiers connus
        const integrityCheck = await this.checkFileIntegrity(filePath, metadata);
        if (integrityCheck.modified) {
            detections.push({
                type: 'integrity_violation',
                description: 'Fichier modifié par rapport à la version originale',
                confidence: 85
            });
        }

        return detections;
    }

    async checkFileIntegrity(filePath, metadata) {
        try {
            const fileName = path.basename(filePath);
            const fileHash = await this.calculateFileHash(filePath);
            
            // Vérifier dans mods.json
            const modsListPath = path.join(__dirname, '..', 'mods.json');
            if (await fs.pathExists(modsListPath)) {
                const modsList = await fs.readJson(modsListPath);
                const modInfo = modsList.find(mod => {
                    const modUrl = typeof mod === 'string' ? mod : mod.url;
                    return modUrl && path.basename(modUrl) === fileName;
                });
                if (modInfo && modInfo.hash && modInfo.hash !== fileHash) {
                    return { modified: true, reason: 'hash_mismatch' };
                }
            }

            // Vérifier dans resources.json
            const resourcesListPath = path.join(__dirname, '..', 'resources.json');
            if (await fs.pathExists(resourcesListPath)) {
                const resourcesList = await fs.readJson(resourcesListPath);
                const allResources = [
                    ...(resourcesList.resourcepacks || []),
                    ...(resourcesList.shaders || [])
                ];
                
                const resourceInfo = allResources.find(res => {
                    if (!res || !res.url) return false;
                    const resFileName = path.basename(res.url);
                    return this.normalizeFileName(fileName) === this.normalizeFileName(resFileName);
                });
                
                if (resourceInfo && resourceInfo.hash && resourceInfo.hash !== fileHash) {
                    return { modified: true, reason: 'hash_mismatch' };
                }
            }

            return { modified: false };
        } catch (error) {
            console.error('Erreur lors de la vérification de l\'intégrité:', error);
            return { modified: false };
        }
    }

    calculateRealConfidence(detections, metadata) {
        // Système de scoring plus sophistiqué
        let totalScore = 0;
        let maxScore = 0;
        
        for (const detection of detections) {
            let score = detection.confidence;
            
            // Facteurs de modification du score
            const factors = {
                fileSize: this.calculateSizeFactor(metadata.size),
                fileType: this.calculateTypeFactor(metadata.name),
                detectionType: this.calculateDetectionTypeFactor(detection.type),
                context: this.calculateContextFactor(detection)
            };
            
            // Appliquer les facteurs
            score *= Object.values(factors).reduce((a, b) => a * b, 1);
            
            totalScore += score;
            maxScore = Math.max(maxScore, score);
        }
        
        // Normaliser le score final
        return Math.min(100, Math.max(0, 
            (maxScore * 0.6) + (totalScore / detections.length * 0.4)
        ));
    }

    calculateSizeFactor(size) {
        // Plus le fichier est gros, plus le facteur est élevé
        const MB = 1024 * 1024;
        if (size > 100 * MB) return 1.2;
        if (size > 50 * MB) return 1.1;
        if (size < 1024) return 0.8;
        return 1.0;
    }

    calculateTypeFactor(fileName) {
        const ext = path.extname(fileName).toLowerCase();
        const factors = {
            '.jar': 1.3,
            '.zip': 1.2,
            '.json': 1.1,
            '.png': 1.0,
            '.txt': 0.9
        };
        return factors[ext] || 1.0;
    }

    calculateDetectionTypeFactor(type) {
        const factors = {
            'xray_detection': 1.3,
            'cheat_detection': 1.2,
            'crash_detection': 1.1,
            'suspicious_modification': 1.0
        };
        return factors[type] || 1.0;
    }

    calculateContextFactor(detection) {
        // Analyse du contexte pour ajuster la confiance
        if (!detection.context) return 1.0;
        
        let factor = 1.0;
        
        // Plus il y a de mots suspects dans le contexte, plus le facteur augmente
        const suspiciousWords = Object.values(SUSPICIOUS_PATTERNS)
            .flatMap(category => category.patterns)
            .filter(pattern => pattern.test(detection.context));
        
        factor += suspiciousWords.length * 0.1;
        
        return Math.min(1.5, factor); // Plafonner à 1.5
    }

    async checkUnauthorizedFiles() {
        const dirsToCheck = [
            { path: path.join(this.gamePath, 'mods'), type: 'mods' },
            { path: path.join(this.gamePath, 'resourcepacks'), type: 'resourcepacks' },
            { path: path.join(this.gamePath, 'shaderpacks'), type: 'shaders' }
        ];

        for (const dir of dirsToCheck) {
            try {
                if (!fs.existsSync(dir.path)) continue;

                // Lire tous les fichiers dans le répertoire
                const files = await fs.readdir(dir.path);
                
                // Charger les listes autorisées
                const modsListPath = path.join(__dirname, '..', 'mods.json');
                const resourcesListPath = path.join(__dirname, '..', 'resources.json');
                
                let authorizedFiles = new Set();
                
                if (dir.type === 'mods' && await fs.pathExists(modsListPath)) {
                    const modsList = await fs.readJson(modsListPath);
                    authorizedFiles = new Set(modsList.map(mod => path.basename(mod)));
                } else if (await fs.pathExists(resourcesListPath)) {
                    const resources = await fs.readJson(resourcesListPath);
                    if (dir.type === 'resourcepacks') {
                        authorizedFiles = new Set(resources.resourcepacks?.map(r => path.basename(r.url)) || []);
                    } else if (dir.type === 'shaders') {
                        authorizedFiles = new Set(resources.shaders?.map(s => path.basename(s.url)) || []);
                    }
                }

                // Vérifier chaque fichier
                for (const file of files) {
                    const filePath = path.join(dir.path, file);
                    const stats = await fs.stat(filePath);

                    if (stats.isFile() && !authorizedFiles.has(file)) {
                        // Fichier non autorisé trouvé
                        await this.analyzeUnauthorizedFile(filePath, dir.type);
                    }
                }
            } catch (error) {
                console.error(`Erreur lors de la vérification des fichiers non autorisés dans ${dir.path}:`, error);
            }
        }
    }

    async analyzeUnauthorizedFile(filePath, fileType) {
        try {
            const stats = await fs.stat(filePath);
            const buffer = await fs.readFile(filePath);
            const fileName = path.basename(filePath);

            // Extraire les métadonnées avancées
            const extractedMetadata = await this.extractAdvancedMetadata(buffer, fileName);

            const metadata = {
                name: fileName,
                path: filePath,
                size: stats.size,
                lastModified: stats.mtime,
                created: stats.birthtime,
                type: fileType,
                extractedInfo: extractedMetadata
            };

            // Analyse avancée avec prise en compte des métadonnées
            const detections = await this.performAdvancedAnalysis(buffer, metadata);
            
            // Ajouter une détection spécifique pour les fichiers non autorisés
            if (fileType === 'mods') {
                detections.push({
                    type: 'unauthorized_mod',
                    description: 'Mod non autorisé détecté (absent de mods.json)',
                    confidence: 90,
                    metadata: extractedMetadata
                });
            }

            if (detections.length > 0) {
                this.handleDetection(metadata, detections);
            }
        } catch (error) {
            console.error(`Erreur lors de l'analyse du fichier non autorisé ${filePath}:`, error);
        }
    }

    async extractAdvancedMetadata(buffer, fileName) {
        const metadata = {
            format: null,
            version: null,
            author: null,
            description: null,
            dependencies: [],
            additionalInfo: {}
        };

        try {
            if (fileName.endsWith('.jar')) {
                const AdmZip = require('adm-zip');
                const zip = new AdmZip(buffer);
                const entries = zip.getEntries();

                // Extraire les informations du MANIFEST.MF
                const manifestEntry = entries.find(entry => 
                    METADATA_EXTRACTORS.JAR.manifest.test(entry.entryName)
                );
                if (manifestEntry) {
                    const manifest = manifestEntry.getData().toString('utf8');
                    metadata.additionalInfo.manifest = this.parseManifest(manifest);
                }

                // Extraire les informations du mod
                const modInfoEntry = entries.find(entry =>
                    METADATA_EXTRACTORS.JAR.modInfo.test(entry.entryName)
                );
                if (modInfoEntry) {
                    const content = modInfoEntry.getData().toString('utf8');
                    try {
                        const modInfo = JSON.parse(content);
                        metadata.format = modInfoEntry.entryName.includes('fabric') ? 'Fabric' : 'Forge';
                        metadata.version = modInfo.version;
                        metadata.author = modInfo.author || modInfo.authors;
                        metadata.description = modInfo.description;
                        metadata.dependencies = modInfo.dependencies || [];
                    } catch (e) {
                        // Si ce n'est pas du JSON, essayer de parser le TOML ou autre format
                        const info = this.parseModInfo(content);
                        Object.assign(metadata, info);
                    }
                }
            } else if (fileName.endsWith('.zip') && fileName.includes('resourcepack')) {
                const AdmZip = require('adm-zip');
                const zip = new AdmZip(buffer);
                const entries = zip.getEntries();

                // Extraire les informations du pack.mcmeta
                const packInfoEntry = entries.find(entry =>
                    METADATA_EXTRACTORS.RESOURCEPACK.packInfo.test(entry.entryName)
                );
                if (packInfoEntry) {
                    const content = packInfoEntry.getData().toString('utf8');
                    try {
                        const packInfo = JSON.parse(content);
                        metadata.format = 'Resource Pack';
                        metadata.version = packInfo.pack.pack_format;
                        metadata.description = packInfo.pack.description;
                    } catch (e) {
                        console.error('Erreur lors du parsing du pack.mcmeta:', e);
                    }
                }
            } else if (fileName.endsWith('.txt')) {
                // Analyser le contenu du fichier texte
                const content = buffer.toString('utf8');
                metadata.format = 'Text';
                metadata.additionalInfo.content = content.substring(0, 1000); // Limiter à 1000 caractères
                
                // Rechercher des informations sensibles
                const sensitivePatterns = {
                    urls: /(https?:\/\/[^\s]+)/g,
                    emails: /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/g,
                    ips: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g
                };

                for (const [key, pattern] of Object.entries(sensitivePatterns)) {
                    const matches = content.match(pattern);
                    if (matches) {
                        metadata.additionalInfo[key] = matches;
                    }
                }
            }
        } catch (error) {
            console.error('Erreur lors de l\'extraction des métadonnées:', error);
        }

        return metadata;
    }

    parseManifest(manifest) {
        const manifestInfo = {};
        const lines = manifest.split('\n');
        
        let currentKey = null;
        let currentValue = [];
        
        for (const line of lines) {
            if (line.trim() === '') continue;
            
            if (line.startsWith(' ')) {
                // Continuation de la valeur précédente
                currentValue.push(line.trim());
            } else {
                // Nouvelle clé
                if (currentKey) {
                    manifestInfo[currentKey] = currentValue.join(' ');
                }
                const [key, ...value] = line.split(':');
                currentKey = key.trim();
                currentValue = [value.join(':').trim()];
            }
        }
        
        // Ajouter la dernière entrée
        if (currentKey) {
            manifestInfo[currentKey] = currentValue.join(' ');
        }
        
        return manifestInfo;
    }

    parseModInfo(content) {
        const info = {
            format: null,
            version: null,
            author: null,
            description: null,
            dependencies: []
        };

        try {
            // Essayer de détecter le format
            if (content.includes('[mods]') || content.includes('modLoader=')) {
                // Format TOML (Forge)
                info.format = 'Forge';
                const lines = content.split('\n');
                for (const line of lines) {
                    if (line.includes('version=')) info.version = line.split('=')[1].trim().replace(/['"]/g, '');
                    if (line.includes('authors=')) info.author = line.split('=')[1].trim().replace(/['"]/g, '');
                    if (line.includes('description=')) info.description = line.split('=')[1].trim().replace(/['"]/g, '');
                }
            } else if (content.includes('modid') && content.includes('name')) {
                // Ancien format mcmod.info
                info.format = 'Forge (Legacy)';
                const matches = {
                    version: content.match(/"version"\s*:\s*"([^"]+)"/),
                    author: content.match(/"authorList"\s*:\s*\[(.*?)\]/),
                    description: content.match(/"description"\s*:\s*"([^"]+)"/)
                };

                if (matches.version) info.version = matches.version[1];
                if (matches.author) info.author = matches.author[1].replace(/['"]/g, '');
                if (matches.description) info.description = matches.description[1];
            }
        } catch (error) {
            console.error('Erreur lors du parsing des informations du mod:', error);
        }

        return info;
    }

    async performAdvancedAnalysis(buffer, metadata) {
        const detections = [];

        try {
            // 1. Analyse d'entropie
            const entropy = await this.calculateFileEntropy(buffer);
            if (entropy > ADVANCED_DETECTION.ENTROPY_THRESHOLDS.HIGH) {
                detections.push({
                    type: 'high_entropy',
                    description: 'Contenu potentiellement obfusqué ou chiffré',
                    confidence: 75 + (entropy - ADVANCED_DETECTION.ENTROPY_THRESHOLDS.HIGH) * 5
                });
            }

            // 2. Analyse comportementale
            const behaviorDetections = await this.analyzeBehavioralPatterns(buffer, metadata);
            detections.push(...behaviorDetections);

            // 3. Analyse temporelle
            const timeDetections = this.analyzeTimestamps(metadata);
            detections.push(...timeDetections);

            // 4. Analyse structurelle
            const structureDetections = await this.analyzeFileStructure(buffer, metadata);
            detections.push(...structureDetections);

            return detections;
        } catch (error) {
            console.error('Erreur lors de l\'analyse avancée:', error);
            return detections;
        }
    }

    calculateFileEntropy(buffer) {
        const frequencies = new Array(256).fill(0);
        for (const byte of buffer) {
            frequencies[byte]++;
        }

        let entropy = 0;
        const bufferLength = buffer.length;

        for (const frequency of frequencies) {
            if (frequency === 0) continue;
            const probability = frequency / bufferLength;
            entropy -= probability * Math.log2(probability);
        }

        return entropy;
    }

    async analyzeBehavioralPatterns(buffer, metadata) {
        const detections = [];
        const content = buffer.toString('utf8');

        // Analyse des patterns de comportement suspect
        for (const [category, patterns] of Object.entries(ADVANCED_DETECTION.BEHAVIOR_PATTERNS)) {
            const matches = patterns.filter(pattern => pattern.test(content));
            if (matches.length > 0) {
                detections.push({
                    type: `suspicious_${category.toLowerCase()}`,
                    description: `Comportement suspect détecté: ${category}`,
                    confidence: 60 + (matches.length * 5),
                    matches: matches.length
                });
            }
        }

        return detections;
    }

    analyzeTimestamps(metadata) {
        const detections = [];
        const now = Date.now();

        // Vérifier les modifications rapides
        if (metadata.lastModified - metadata.created < ADVANCED_DETECTION.TIME_THRESHOLDS.RAPID_MODIFICATION) {
            detections.push({
                type: 'rapid_modification',
                description: 'Fichier modifié très rapidement après sa création',
                confidence: 70
            });
        }

        // Vérifier les créations récentes
        if (now - metadata.created < ADVANCED_DETECTION.TIME_THRESHOLDS.SUSPICIOUS_CREATION) {
            detections.push({
                type: 'recent_creation',
                description: 'Fichier créé très récemment',
                confidence: 65
            });
        }

        return detections;
    }

    async analyzeFileStructure(buffer, metadata) {
        const detections = [];

        try {
            // Analyse de la structure des fichiers ZIP/JAR
            if (metadata.name.endsWith('.zip') || metadata.name.endsWith('.jar')) {
                const AdmZip = require('adm-zip');
                const zip = new AdmZip(buffer);
                const entries = zip.getEntries();

                // Vérifier les fichiers cachés
                const hiddenFiles = entries.filter(entry => entry.entryName.startsWith('.'));
                if (hiddenFiles.length > 0) {
                    detections.push({
                        type: 'hidden_files',
                        description: 'Fichiers cachés détectés dans l\'archive',
                        confidence: 75,
                        count: hiddenFiles.length
                    });
                }

                // Vérifier les exécutables dans l'archive
                const executableFiles = entries.filter(entry => 
                    UNSAFE_EXTENSIONS.some(ext => entry.entryName.endsWith(ext))
                );
                if (executableFiles.length > 0) {
                    detections.push({
                        type: 'embedded_executables',
                        description: 'Fichiers exécutables détectés dans l\'archive',
                        confidence: 85,
                        count: executableFiles.length
                    });
                }
            }

            // Analyse des signatures de fichiers
            const fileSignature = buffer.slice(0, 4).toString('hex');
            const knownSignatures = {
                '504B0304': 'ZIP/JAR',
                '89504E47': 'PNG',
                'FFD8FFE0': 'JPEG',
                '7F454C46': 'ELF'
            };

            if (knownSignatures[fileSignature] && 
                !metadata.name.endsWith(`.${knownSignatures[fileSignature].toLowerCase()}`)) {
                detections.push({
                    type: 'signature_mismatch',
                    description: 'Extension de fichier ne correspond pas au contenu',
                    confidence: 80
                });
            }

        } catch (error) {
            console.error('Erreur lors de l\'analyse de la structure:', error);
        }

        return detections;
    }

    async analyzeArchiveContent(buffer, metadata) {
        const detections = [];
        try {
            const AdmZip = require('adm-zip');
            let zip;
            
            try {
                zip = new AdmZip(buffer);
            } catch (error) {
                // Si l'archive est invalide ou corrompue
                detections.push({
                    type: 'invalid_archive',
                    description: 'Archive invalide ou corrompue',
                    confidence: 85,
                    error: error.message
                });
                return detections;
            }

            const entries = zip.getEntries();

            // Vérifier chaque entrée de l'archive
            for (const entry of entries) {
                try {
                    // 1. Vérifier le nom de l'entrée
                    for (const [category, data] of Object.entries(SUSPICIOUS_PATTERNS)) {
                        for (const pattern of data.patterns) {
                            if (pattern.test(entry.entryName)) {
                                detections.push({
                                    type: `${category.toLowerCase()}_archive_name`,
                                    description: `Fichier suspect dans l'archive (${category})`,
                                    confidence: data.baseConfidence,
                                    file: entry.entryName
                                });
                            }
                        }
                    }

                    // 2. Vérifier le contenu des fichiers texte
                    if (entry.entryName.endsWith('.json') || 
                        entry.entryName.endsWith('.txt') || 
                        entry.entryName.endsWith('.properties') ||
                        entry.entryName.endsWith('.mcmeta')) {
                        const content = entry.getData().toString('utf8');
                        
                        for (const [category, data] of Object.entries(SUSPICIOUS_PATTERNS)) {
                            for (const pattern of data.patterns) {
                                if (pattern.test(content)) {
                                    detections.push({
                                        type: `${category.toLowerCase()}_archive_content`,
                                        description: `Contenu suspect dans le fichier ${entry.entryName} (${category})`,
                                        confidence: data.baseConfidence + 5,
                                        file: entry.entryName
                                    });
                                }
                            }
                        }
                    }

                    // 3. Analyse des textures
                    if (entry.entryName.endsWith('.png')) {
                        try {
                            const imageBuffer = entry.getData();
                            const textureDetection = await this.analyzeTextureForXray(imageBuffer);
                            if (textureDetection) {
                                detections.push({
                                    ...textureDetection,
                                    file: entry.entryName
                                });
                            }
                        } catch (error) {
                            console.error(`Erreur lors de l'analyse de la texture ${entry.entryName}:`, error);
                        }
                    }
                } catch (error) {
                    console.error(`Erreur lors de l'analyse de l'entrée ${entry.entryName}:`, error);
                    continue;
                }
            }

        } catch (error) {
            console.error('Erreur lors de l\'analyse de l\'archive:', error);
        }

        return detections;
    }

    async calculateFileHash(filePath) {
        try {
            const buffer = await fs.readFile(filePath);
            const hash = crypto.createHash('sha256');
            hash.update(buffer);
            return hash.digest('hex');
        } catch (error) {
            console.error(`Erreur lors du calcul du hash pour ${filePath}:`, error);
            return null;
        }
    }

    async getDetectionDetails(detectionId) {
        try {
            // Parcourir toutes les détections pour trouver celle avec l'ID correspondant
            for (const [filePath, detections] of this.suspiciousFiles.entries()) {
                const detection = detections.find(d => d.id === detectionId);
                if (detection) {
                    // Enrichir les détails avec des informations supplémentaires
                    const enrichedDetails = {
                        ...detection,
                        fileInfo: await this.getFileInfo(filePath),
                        metadata: await this.extractAdvancedMetadata(
                            await fs.readFile(filePath),
                            path.basename(filePath)
                        ),
                        analysisDate: new Date().toISOString()
                    };

                    return enrichedDetails;
                }
            }
            return null;
        } catch (error) {
            console.error('Erreur lors de la récupération des détails:', error);
            throw error;
        }
    }

    async getFileInfo(filePath) {
        try {
            const stats = await fs.stat(filePath);
            return {
                name: path.basename(filePath),
                path: filePath,
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime,
                hash: await this.calculateFileHash(filePath),
                type: path.extname(filePath),
                isArchive: ['.zip', '.jar'].includes(path.extname(filePath).toLowerCase())
            };
        } catch (error) {
            console.error('Erreur lors de la récupération des informations du fichier:', error);
            return null;
        }
    }

    async deleteDetectedFile(detectionId) {
        try {
            // Trouver le fichier correspondant à la détection
            for (const [filePath, detections] of this.suspiciousFiles.entries()) {
                const detection = detections.find(d => d.id === detectionId);
                if (detection) {
                    // Vérifier si le fichier existe toujours
                    if (await fs.pathExists(filePath)) {
                        // Créer une sauvegarde dans la quarantaine avant la suppression
                        await this.quarantineFile(filePath);
                        
                        // Supprimer le fichier
                        await fs.remove(filePath);
                        
                        // Supprimer la détection de la liste
                        this.suspiciousFiles.set(
                            filePath,
                            detections.filter(d => d.id !== detectionId)
                        );
                        
                        // Si plus aucune détection pour ce fichier, supprimer l'entrée
                        if (this.suspiciousFiles.get(filePath).length === 0) {
                            this.suspiciousFiles.delete(filePath);
                        }

                        // Émettre un événement pour mettre à jour l'interface
                        this.emit('fileDeleted', {
                            detectionId,
                            filePath,
                            allDetections: Array.from(this.suspiciousFiles.entries()).map(([path, dets]) => ({
                                path,
                                detections: dets
                            }))
                        });

                        return {
                            success: true,
                            message: `Fichier ${path.basename(filePath)} supprimé avec succès`
                        };
                    } else {
                        // Le fichier n'existe plus, nettoyer les détections
                        this.suspiciousFiles.delete(filePath);
                        this.emit('fileDeleted', {
                            detectionId,
                            filePath,
                            allDetections: Array.from(this.suspiciousFiles.entries()).map(([path, dets]) => ({
                                path,
                                detections: dets
                            }))
                        });
                        return {
                            success: false,
                            message: 'Le fichier n\'existe plus'
                        };
                    }
                }
            }
            return {
                success: false,
                message: 'Détection non trouvée'
            };
        } catch (error) {
            console.error('Erreur lors de la suppression du fichier:', error);
            throw error;
        }
    }
}

module.exports = SecurityChecker; 