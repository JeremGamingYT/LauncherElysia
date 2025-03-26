/**
 * Webhook pour Discord actualités
 * 
 * Ce script permet de:
 * 1. Recevoir des événements depuis Discord via un webhook
 * 2. Mettre à jour un fichier JSON d'actualités quand de nouveaux messages sont publiés
 * 
 * Installation:
 * 1. npm install express axios fs-extra dotenv
 * 2. Créer un fichier .env avec WEBHOOK_SECRET=votre_secret
 * 3. Configurer le webhook dans Discord (Paramètres du serveur > Intégrations > Webhooks)
 *    - URL: https://votre-serveur.com/webhook
 *    - Contenu: application/json
 */

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'your-secret-here';
const NEWS_FILE_PATH = path.join(__dirname, 'public', 'news.json');

// S'assurer que le dossier public existe
fs.ensureDirSync(path.join(__dirname, 'public'));

// Middleware pour parser le JSON
app.use(express.json());

// Middleware pour servir le fichier JSON statique
app.use('/public', express.static(path.join(__dirname, 'public')));

// Route pour le status du serveur
app.get('/status', (req, res) => {
    res.json({ status: 'online' });
});

// Webhook endpoint pour Discord
app.post('/webhook', async (req, res) => {
    // Vérifier le secret (vous pouvez implémenter une vérification plus sécurisée)
    const secret = req.headers['x-webhook-secret'];
    if (secret !== WEBHOOK_SECRET) {
        return res.status(403).json({ error: 'Accès non autorisé' });
    }

    try {
        // Extraire les données du message Discord
        const { message, channel_id, guild_id } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Format de message invalide' });
        }

        // Lire le fichier d'actualités existant ou créer un nouveau tableau
        let newsData = { messages: [] };
        if (await fs.pathExists(NEWS_FILE_PATH)) {
            try {
                newsData = await fs.readJson(NEWS_FILE_PATH);
            } catch (err) {
                console.error('Erreur lors de la lecture du fichier d\'actualités:', err);
            }
        }

        // S'assurer que messages est un tableau
        if (!Array.isArray(newsData.messages)) {
            newsData.messages = [];
        }

        // Créer l'objet d'actualité à partir du message Discord
        const embed = message.embeds && message.embeds.length > 0 ? message.embeds[0] : null;
        
        const newsItem = {
            id: message.id,
            title: embed ? embed.title : message.content.substring(0, 50) + (message.content.length > 50 ? '...' : ''),
            content: embed ? embed.description : message.content,
            author: message.author.username,
            timestamp: message.timestamp || new Date().toISOString(),
            image: embed && embed.image ? embed.image.url : null,
            url: `https://discord.com/channels/${guild_id}/${channel_id}/${message.id}`
        };

        // Ajouter le nouveau message au début du tableau (plus récent en premier)
        newsData.messages.unshift(newsItem);
        
        // Limiter à 20 messages maximum
        newsData.messages = newsData.messages.slice(0, 20);

        // Sauvegarder le fichier mis à jour
        await fs.writeJson(NEWS_FILE_PATH, newsData, { spaces: 2 });

        res.json({ success: true, message: 'Actualité ajoutée avec succès' });
    } catch (error) {
        console.error('Erreur lors du traitement du webhook:', error);
        res.status(500).json({ error: 'Erreur serveur', message: error.message });
    }
});

// Démarrer le serveur
app.listen(PORT, () => {
    console.log(`Serveur webhook démarré sur le port ${PORT}`);
    
    // Créer un fichier d'actualités par défaut s'il n'existe pas
    if (!fs.existsSync(NEWS_FILE_PATH)) {
        const defaultNews = {
            messages: [
                {
                    id: 'default',
                    title: 'Bienvenue sur le serveur Elysia',
                    content: 'Les actualités apparaîtront ici dès qu\'elles seront publiées sur Discord.',
                    author: 'Système',
                    timestamp: new Date().toISOString(),
                    image: null,
                    url: 'https://discord.gg/votre-serveur'
                }
            ]
        };
        
        fs.writeJsonSync(NEWS_FILE_PATH, defaultNews, { spaces: 2 });
        console.log('Fichier d\'actualités par défaut créé');
    }
}); 