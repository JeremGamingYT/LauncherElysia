const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

/**
 * Module pour gérer les mises à jour du jeu
 */
class UpdatesManager {
    constructor(options = {}) {
        this.updates = [];
        this.localPath = options.localPath || path.join(process.env.APPDATA, '.elysia', 'updates.json');
        this.remoteUrl = options.remoteUrl || null;
        this.owner = options.owner || 'JeremGamingYT';
        this.repo = options.repo || 'LauncherElysia';
    }

    /**
     * Définir l'URL distante pour obtenir les mises à jour
     * @param {string} url URL du fichier JSON des mises à jour
     */
    setRemoteUrl(url) {
        this.remoteUrl = url;
    }

    /**
     * Charger les mises à jour locales
     * @returns {Promise<Array>} Liste des mises à jour
     */
    async loadLocalUpdates() {
        try {
            if (await fs.exists(this.localPath)) {
                const data = await fs.readFile(this.localPath, 'utf8');
                this.updates = JSON.parse(data);
                return this.updates;
            }
            return [];
        } catch (error) {
            console.error('Erreur lors du chargement des mises à jour locales:', error);
            return [];
        }
    }

    /**
     * Télécharger les mises à jour depuis l'API GitHub Releases
     * @returns {Promise<Array>} Liste des mises à jour
     */
    async fetchRemoteUpdates() {
        try {
            // Essayer d'abord le fichier JSON si une URL est spécifiée
            if (this.remoteUrl) {
                try {
                    const response = await axios.get(this.remoteUrl);
                    if (response.data && Array.isArray(response.data)) {
                        this.updates = response.data;
                        await this.saveLocalUpdates();
                        return this.updates;
                    }
                } catch (jsonError) {
                    console.log('Fichier JSON de mises à jour non trouvé, utilisation de l\'API GitHub Releases');
                }
            }

            // Utiliser l'API GitHub Releases comme fallback
            const githubApiUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/releases`;
            const response = await axios.get(githubApiUrl, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (response.data && Array.isArray(response.data)) {
                // Transformer les données de l'API GitHub en format d'updates
                this.updates = response.data.map(release => {
                    // Extraire le numéro de version à partir du tag
                    const version = release.tag_name.replace(/^v/, '');
                    
                    // Extraire les changements du body en format markdown
                    let changes = [];
                    let formattedBody = '';
                    
                    if (release.body) {
                        // Formater le contenu pour l'affichage HTML
                        formattedBody = release.body
                            .replace(/\r\n/g, '<br>')
                            .replace(/\n/g, '<br>')
                            .replace(/\r/g, '<br>');
                        
                        // Extraction simple des éléments de liste (lignes commençant par - ou *)
                        const changeLines = release.body.split('\n')
                            .filter(line => line.trim().match(/^[-*] /))
                            .map(line => line.replace(/^[-*] /, '').trim());
                        
                        if (changeLines.length > 0) {
                            changes = changeLines;
                        }
                    }

                    return {
                        id: release.id.toString(),
                        version: version,
                        date: release.published_at,
                        title: release.name || `Version ${version}`,
                        description: formattedBody || 'Aucune description disponible',
                        content: formattedBody || 'Aucune description disponible',
                        changes: changes
                    };
                });

                // Sauvegarder localement
                await this.saveLocalUpdates();
                return this.updates;
            }
            
            return this.updates;
        } catch (error) {
            console.error('Erreur lors du téléchargement des mises à jour:', error);
            return this.updates;
        }
    }

    /**
     * Sauvegarder les mises à jour localement
     * @returns {Promise<boolean>} Succès ou échec
     */
    async saveLocalUpdates() {
        try {
            await fs.ensureDir(path.dirname(this.localPath));
            await fs.writeFile(this.localPath, JSON.stringify(this.updates, null, 2), 'utf8');
            return true;
        } catch (error) {
            console.error('Erreur lors de la sauvegarde des mises à jour:', error);
            return false;
        }
    }

    /**
     * Obtenir la liste des mises à jour
     * @param {number} limit Nombre de mises à jour à retourner
     * @returns {Array} Liste des mises à jour
     */
    getUpdates(limit = 10) {
        return this.updates.slice(0, limit);
    }

    /**
     * Ajouter une nouvelle mise à jour
     * @param {Object} update Objet de mise à jour
     * @returns {Promise<boolean>} Succès ou échec
     */
    async addUpdate(update) {
        if (!update.title || !update.description) {
            console.error('Titre et description requis pour une mise à jour');
            return false;
        }

        const newUpdate = {
            version: update.version || 'N/A',
            date: update.date || new Date().toISOString(),
            title: update.title,
            description: update.description,
            changes: update.changes || []
        };

        this.updates.unshift(newUpdate);
        await this.saveLocalUpdates();
        return true;
    }
}

module.exports = UpdatesManager; 