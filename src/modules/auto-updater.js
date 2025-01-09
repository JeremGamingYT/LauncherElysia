const { app } = require('electron');
const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

class AutoUpdater {
    constructor(owner, repo) {
        this.owner = owner;
        this.repo = repo;
        this.octokit = new Octokit();
        this.currentVersion = app.getVersion();
    }

    async checkForUpdates() {
        try {
            const { data: latestRelease } = await this.octokit.repos.getLatestRelease({
                owner: this.owner,
                repo: this.repo
            });

            const latestVersion = latestRelease.tag_name.replace('v', '');
            
            // Vérification stricte de la version
            if (latestVersion === this.currentVersion) {
                return { hasUpdate: false };
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

                // Utiliser l'URL de téléchargement directe fournie par GitHub
                console.log('URL de téléchargement:', exeAsset.browser_download_url);
                console.log('Taille du fichier:', exeAsset.size);

                return {
                    hasUpdate: true,
                    version: latestVersion,
                    downloadUrl: exeAsset.browser_download_url,
                    fileSize: exeAsset.size
                };
            }

            return { hasUpdate: false };
        } catch (error) {
            console.error('Erreur lors de la vérification des mises à jour:', error);
            return { hasUpdate: false, error };
        }
    }

    isNewerVersion(latest, current) {
        const latestParts = latest.split('.').map(Number);
        const currentParts = current.split('.').map(Number);

        for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
            const latestPart = latestParts[i] || 0;
            const currentPart = currentParts[i] || 0;
            
            if (latestPart > currentPart) return true;
            if (latestPart < currentPart) return false;
        }
        return false;
    }

    async downloadUpdate(downloadUrl) {
        // Extraire le nom du fichier de l'URL
        const originalFileName = downloadUrl.split('/').pop();
        const setupPath = path.join(app.getPath('temp'), originalFileName);
        
        console.log('Début du téléchargement:', downloadUrl);
        console.log('Chemin de destination:', setupPath);

        // Supprimer l'ancien fichier s'il existe
        if (fs.existsSync(setupPath)) {
            try {
                await fs.promises.unlink(setupPath);
                console.log('Ancien fichier supprimé avec succès');
            } catch (error) {
                console.error('Erreur lors de la suppression de l\'ancien fichier:', error);
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
                    // Fermer le fichier actuel
                    file.close();
                    
                    // Créer une nouvelle requête pour la redirection
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

                        let downloadedBytes = 0;
                        redirectResponse.on('data', chunk => {
                            downloadedBytes += chunk.length;
                            console.log(`Téléchargement en cours: ${downloadedBytes} bytes`);
                        });

                        // Créer un nouveau writeStream
                        const redirectFile = fs.createWriteStream(setupPath);
                        redirectResponse.pipe(redirectFile);

                        redirectFile.on('finish', () => {
                            redirectFile.close();
                            console.log('Téléchargement terminé, vérification du fichier...');
                            
                            try {
                                const stats = fs.statSync(setupPath);
                                console.log('Taille du fichier téléchargé:', stats.size);
                                
                                if (stats.size === 0) {
                                    reject(new Error('Le fichier téléchargé est vide'));
                                    return;
                                }
                                
                                console.log('Téléchargement terminé avec succès');
                                resolve(setupPath);
                            } catch (error) {
                                reject(error);
                            }
                        });

                        redirectFile.on('error', err => {
                            console.error('Erreur lors de l\'écriture après redirection:', err);
                            reject(err);
                        });
                    });

                    redirectRequest.on('error', err => {
                        console.error('Erreur lors de la redirection:', err);
                        reject(err);
                    });
                } else if (response.statusCode !== 200) {
                    reject(new Error(`Erreur HTTP: ${response.statusCode}`));
                    return;
                }
            });

            request.on('error', err => {
                console.error('Erreur lors de la requête initiale:', err);
                reject(err);
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