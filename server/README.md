# Webhook pour les Actualités Discord

Ce serveur webhook fait le lien entre votre serveur Discord et le launcher Elysia. Il reçoit les nouveaux messages du canal Discord via un webhook et génère un fichier JSON d'actualités que le launcher pourra récupérer.

## Avantages

1. **Sécurité** : Aucun token de bot Discord n'est nécessaire dans le launcher
2. **Simplicité** : Utilise les webhooks natifs de Discord, pas besoin d'un bot personnalisé
3. **Performance** : Le launcher télécharge simplement un petit fichier JSON statique
4. **Déploiement facile** : Peut être hébergé sur n'importe quel serveur web ou même sur un service d'hébergement statique

## Installation

1. Prérequis : Node.js 14+ installé sur votre serveur
2. Clonez ce répertoire sur votre serveur web
3. Installez les dépendances :
   ```
   npm install
   ```
4. Créez un fichier `.env` avec les informations suivantes :
   ```
   WEBHOOK_SECRET=votre_secret_pour_sécuriser_le_webhook
   PORT=3000  # Port optionnel, 3000 par défaut
   ```
5. Démarrez le serveur :
   ```
   npm start
   ```

## Configuration dans Discord

1. Allez dans les paramètres de votre serveur Discord
2. Ouvrez la section "Intégrations" puis "Webhooks"
3. Créez un nouveau webhook et configurez-le :
   - Nom : Actualités Elysia (ou autre nom que vous préférez)
   - Canal : Sélectionnez votre canal d'actualités
   - URL : `https://votre-serveur.com/webhook` (ajoutez le header `x-webhook-secret` avec votre secret)

## Utilisation avec le launcher

Dans le fichier `main.js` du launcher, assurez-vous que l'URL du fichier JSON est correctement configurée :

```javascript
const newsJsonUrl = 'https://votre-serveur.com/public/news.json';
```

## Déploiement

Pour un déploiement en production, utilisez PM2 :

```
npm install -g pm2
pm2 start discord-webhook.js --name "discord-webhook"
pm2 save
pm2 startup
```

## Sécurité

- Utilisez HTTPS pour sécuriser les communications
- Changez le secret du webhook et gardez-le confidentiel
- Configurez correctement les en-têtes CORS pour limiter les accès

## Structure du fichier JSON

Le fichier JSON généré (`news.json`) aura la structure suivante :

```json
{
  "messages": [
    {
      "id": "1234567890123456789",
      "title": "Titre de l'actualité",
      "content": "Contenu de l'actualité...",
      "author": "Nom de l'auteur",
      "timestamp": "2023-08-15T12:30:45Z",
      "image": "https://url-de-l-image.png",
      "url": "https://discord.com/channels/..."
    },
    ...
  ]
}
``` 