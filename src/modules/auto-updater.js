const { app } = require('electron');
const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const EventEmitter = require('events');

class AutoUpdater extends EventEmitter {
    constructor(owner, repo) {
        super();
        this.owner = owner;
        this.repo = repo;
        this.octokit = new Octokit();
        try {
            const packageJson = require('../../package.json');
            this.currentVersion = packageJson.version;
            console.log('Version actuelle du launcher:', this.currentVersion);
        } catch (error) {
            console.error('Erreur lors de la lecture de la version:', error);
            this.currentVersion = '0.0.0';
        }
    }

    async checkForUpdates() {
        try {
            console.log('Vérification des mises à jour...');
            console.log('Version actuelle:', this.currentVersion);

            const { data: latestRelease } = await this.octokit.repos.getLatestRelease({
                owner: this.owner,
                repo: this.repo
            });

            const latestVersion = latestRelease.tag_name.replace('v', '');
            console.log('Dernière version disponible:', latestVersion);
            
            if (latestVersion === this.currentVersion) {
                console.log('Le launcher est à jour');
                return { 
                    hasUpdate: false,
                    currentVersion: this.currentVersion,
                    latestVersion: latestVersion
                };
            }

            if (this.isNewerVersion(latestVersion, this.currentVersion)) {
                const exeAsset = latestRelease.assets.find(asset => 
                    asset.name.toLowerCase().includes('elysia-setup') && 
                    asset.name.endsWith('.exe')
                );

                if (!exeAsset) {
                    console.error('Aucun fichier setup.exe trouvé dans la release');
                    return { hasUpdate: false };
                }

                const downloadUrl = exeAsset.browser_download_url;
                console.log('URL de téléchargement:', downloadUrl);
                console.log('Taille du fichier:', exeAsset.size);

                if (!downloadUrl) {
                    console.error('URL de téléchargement non trouvée');
                    return { hasUpdate: false };
                }

                return {
                    hasUpdate: true,
                    currentVersion: this.currentVersion,
                    latestVersion: latestVersion,
                    downloadUrl: downloadUrl,
                    fileSize: exeAsset.size,
                    releaseNotes: latestRelease.body || 'Aucune note de mise à jour disponible'
                };
            }

            return { 
                hasUpdate: false,
                currentVersion: this.currentVersion,
                latestVersion: latestVersion
            };
        } catch (error) {
            console.error('Erreur lors de la vérification des mises à jour:', error);
            return { 
                hasUpdate: false, 
                error,
                currentVersion: this.currentVersion
            };
        }
    }

    isNewerVersion(latest, current) {
        try {
            const latestParts = latest.split('.').map(Number);
            const currentParts = current.split('.').map(Number);

            if (latestParts.some(isNaN) || currentParts.some(isNaN)) {
                console.error('Format de version invalide');
                return false;
            }

            for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
                const latestPart = latestParts[i] || 0;
                const currentPart = currentParts[i] || 0;
                
                if (latestPart > currentPart) {
                    console.log(`Nouvelle version disponible: ${latest} > ${current}`);
                    return true;
                }
                if (latestPart < currentPart) {
                    console.log(`Version actuelle plus récente: ${current} > ${latest}`);
                    return false;
                }
            }
            console.log('Versions identiques:', current);
            return false;
        } catch (error) {
            console.error('Erreur lors de la comparaison des versions:', error);
            return false;
        }
    }

    async downloadUpdate(downloadUrl) {
        if (!downloadUrl) {
            throw new Error('URL de téléchargement non définie');
        }

        const originalFileName = downloadUrl.split('/').pop();
        let setupPath = path.join(app.getPath('temp'), originalFileName);
        
        console.log('Début du téléchargement:', downloadUrl);
        console.log('Chemin de destination:', setupPath);

        if (fs.existsSync(setupPath)) {
            try {
                await fs.promises.unlink(setupPath);
                console.log('Ancien fichier supprimé avec succès');
            } catch (error) {
                console.error('Erreur lors de la suppression de l\'ancien fichier:', error);
                setupPath = path.join(app.getPath('temp'), `Elysia-Setup-${Date.now()}.exe`);
                console.log('Utilisation d\'un nom de fichier unique:', setupPath);
            }
        }

        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(setupPath);
            
            const request = https.get(downloadUrl, {
                headers: {
                    'User-Agent': 'Elysia-Launcher',
                    'Accept': 'application/octet-stream'
                }
            }, response => {
                console.log('Code de statut HTTP:', response.statusCode);

                if (response.statusCode === 302 || response.statusCode === 301) {
                    file.close();
                    
                    const redirectRequest = https.get(response.headers.location, {
                        headers: {
                            'User-Agent': 'Elysia-Launcher',
                            'Accept': 'application/octet-stream'
                        }
                    }, redirectResponse => {
                        if (redirectResponse.statusCode !== 200) {
                            reject(new Error(`Erreur HTTP après redirection: ${redirectResponse.statusCode}`));
                            return;
                        }

                        const totalSize = parseInt(redirectResponse.headers['content-length'], 10);
                        let downloadedSize = 0;

                        redirectResponse.on('data', chunk => {
                            downloadedSize += chunk.length;
                            const percent = (downloadedSize / totalSize) * 100;
                            this.emit('download-progress', {
                                percent: percent,
                                downloaded: downloadedSize,
                                total: totalSize
                            });
                        });

                        const redirectFile = fs.createWriteStream(setupPath);
                        redirectResponse.pipe(redirectFile);

                        redirectFile.on('finish', () => {
                            redirectFile.close();
                            console.log('Téléchargement terminé, vérification du fichier...');
                            
                            try {
                                const stats = fs.statSync(setupPath);
                                if (stats.size === 0) {
                                    reject(new Error('Le fichier téléchargé est vide'));
                                    return;
                                }
                                resolve(setupPath);
                            } catch (error) {
                                reject(error);
                            }
                        });
                    });
                } else if (response.statusCode === 200) {
                    const totalSize = parseInt(response.headers['content-length'], 10);
                    let downloadedSize = 0;

                    response.on('data', chunk => {
                        downloadedSize += chunk.length;
                        const percent = (downloadedSize / totalSize) * 100;
                        this.emit('download-progress', {
                            percent: percent,
                            downloaded: downloadedSize,
                            total: totalSize
                        });
                    });

                    response.pipe(file);

                    file.on('finish', () => {
                        file.close();
                        resolve(setupPath);
                    });
                } else {
                    reject(new Error(`Erreur HTTP: ${response.statusCode}`));
                }
            });

            request.on('error', error => {
                fs.unlink(setupPath, () => {
                    reject(error);
                });
            });
        });
    }

    async installUpdate(setupPath) {
        try {
            console.log('Démarrage de l\'installation:', setupPath);
            
            // Vérifier que le fichier existe
            if (!fs.existsSync(setupPath)) {
                throw new Error('Le fichier d\'installation n\'existe pas');
            }

            // Ne plus supprimer l'intégralité du dossier .elysia.
            // Laisser les ressources déjà installées (mods, resourcepacks, etc.)
            // afin d'éviter de tout re-télécharger lors d'une mise à jour.
            // Désormais, seules les ressources manquantes seront réinstallées
            // grâce aux vérifications déjà présentes au démarrage du launcher.

            // Exécuter le setup avec les paramètres silencieux
            const process = require('child_process');
            
            console.log('Lancement du processus d\'installation...');
            
            // Utiliser exec au lieu de spawn
            process.exec(`"${setupPath}" /SILENT /CLOSEAPPLICATIONS`, (error, stdout, stderr) => {
                if (error) {
                    console.error('Erreur lors de l\'exécution:', error);
                    return;
                }
                if (stderr) {
                    console.error('Stderr:', stderr);
                }
                if (stdout) {
                    console.log('Stdout:', stdout);
                }
            });

            // Attendre un peu avant de fermer l'application
            console.log('Installation lancée, fermeture de l\'application dans 3 secondes...');
            setTimeout(() => {
                app.quit();
            }, 3000);

        } catch (error) {
            console.error('Erreur lors de l\'installation de la mise à jour:', error);
            throw error;
        }
    }
}

module.exports = AutoUpdater; 