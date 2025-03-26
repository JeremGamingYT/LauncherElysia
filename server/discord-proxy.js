/**
 * Discord News Proxy Server
 * 
 * Ce serveur agit comme un proxy entre le launcher et l'API Discord.
 * Il récupère les messages du canal spécifié et les transforme dans le format attendu par le launcher.
 * 
 * Installation:
 * 1. Créez un dossier 'server' sur votre serveur web
 * 2. Placez ce fichier dans le dossier
 * 3. Installez les dépendances: npm install express axios dotenv
 * 4. Créez un fichier .env avec DISCORD_BOT_TOKEN=votre_token
 * 5. Démarrez le serveur: node discord-proxy.js
 */

const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration Discord
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || 'votre_token_bot_discord';
// Liste des canaux autorisés (pour éviter les abus)
const ALLOWED_CHANNELS = ['1234567890123456789'];

// Middleware CORS pour permettre les requêtes depuis le launcher
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Route pour récupérer les messages Discord
app.get('/discord-news', async (req, res) => {
  try {
    const channelId = req.query.channel;
    const limit = req.query.limit || 5;
    
    // Vérifier si le canal est autorisé
    if (!ALLOWED_CHANNELS.includes(channelId)) {
      return res.status(403).json({ 
        error: 'Canal non autorisé',
        messages: [] 
      });
    }

    // Récupérer les messages depuis l'API Discord
    const response = await axios.get(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`,
      {
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data) {
      // Transformer les messages dans le format attendu par le launcher
      const messages = response.data.map(message => {
        // Extraire le premier embed si disponible
        const embed = message.embeds && message.embeds.length > 0 ? message.embeds[0] : null;
        
        return {
          id: message.id,
          title: embed ? embed.title : message.content.substring(0, 50) + (message.content.length > 50 ? '...' : ''),
          content: embed ? embed.description : message.content,
          author: message.author.username,
          timestamp: message.timestamp,
          image: embed && embed.image ? embed.image.url : null,
          url: `https://discord.com/channels/${message.guild_id}/${message.channel_id}/${message.id}`
        };
      });

      return res.json({ messages });
    }
    
    return res.json({ messages: [] });
  } catch (error) {
    console.error('Erreur lors de la récupération des messages Discord:', error);
    return res.status(500).json({ 
      error: 'Erreur serveur', 
      message: error.message,
      messages: [] 
    });
  }
});

// Route de statut pour vérifier que le serveur fonctionne
app.get('/status', (req, res) => {
  res.json({ status: 'online' });
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`Serveur proxy Discord démarré sur le port ${PORT}`);
}); 