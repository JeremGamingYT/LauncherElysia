const axios = require('axios');

/**
 * Module pour récupérer les actualités depuis un fichier JSON hébergé sur GitHub
 */
class DiscordNewsManager {
    constructor(options = {}) {
        this.newsUrl = options.newsUrl || 'https://raw.githubusercontent.com/JeremGamingYT/LauncherElysia/main/news.json';
        this.limit = options.limit || 5;
        this.news = [];
    }

    /**
     * Récupérer les actualités depuis le fichier JSON hébergé sur GitHub
     * @returns {Promise<Array>} Tableau d'actualités
     */
    async fetchNews() {
        try {
            const response = await axios.get(this.newsUrl);

            if (response.data && Array.isArray(response.data.messages)) {
                // Limiter le nombre d'actualités selon l'option
                this.news = response.data.messages.slice(0, this.limit);
                return this.news;
            } else if (response.data && Array.isArray(response.data)) {
                // Format alternatif où les données sont directement un tableau
                this.news = response.data.slice(0, this.limit);
                return this.news;
            }
            
            return [];
        } catch (error) {
            console.error('Erreur lors de la récupération des actualités:', error);
            return [];
        }
    }

    /**
     * Obtenir les actualités en cache
     * @returns {Array} Tableau d'actualités
     */
    getNews() {
        return this.news;
    }
}

module.exports = DiscordNewsManager; 