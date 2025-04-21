const { app } = require('electron');
const RPC = require('discord-rpc');
const path = require('path');
const Store = require('electron-store');

class DiscordRPCManager {
    constructor(clientId) {
        this.clientId = clientId;
        this.rpc = new RPC.Client({ transport: 'ipc' });
        this.connected = false;
        this.startTimestamp = null;
        this.store = new Store();
        this.serverDetails = null;
    }

    /**
     * Initialise la connexion avec Discord
     * @returns {Promise<boolean>} - True si la connexion a réussi
     */
    async initialize() {
        try {
            return new Promise((resolve) => {
                this.rpc.on('ready', () => {
                    this.connected = true;
                    console.log('Discord RPC prêt!', this.rpc.user.username);
                    resolve(true);
                });

                // Connexion à Discord
                this.rpc.login({ clientId: this.clientId }).catch(error => {
                    console.error('Erreur de connexion à Discord RPC:', error);
                    this.connected = false;
                    resolve(false);
                });

                // Définir un délai au cas où Discord n'est pas lancé
                setTimeout(() => {
                    if (!this.connected) {
                        console.warn('Discord RPC timeout - Discord n\'est probablement pas lancé');
                        resolve(false);
                    }
                }, 10000);
            });
        } catch (error) {
            console.error('Erreur lors de l\'initialisation de Discord RPC:', error);
            return false;
        }
    }

    /**
     * Met à jour le statut avec les informations du jeu
     * @param {Object} options - Options pour la mise à jour de la présence
     */
    updatePresence(options = {}) {
        if (!this.connected) {
            console.warn('Tentative de mise à jour de la Rich Presence sans connexion Discord');
            return false;
        }

        try {
            const presence = {
                largeImageKey: options.largeImageKey || 'elysia_icon',
                largeImageText: options.largeImageText || 'Elysia Launcher',
                smallImageKey: options.smallImageKey,
                smallImageText: options.smallImageText,
                details: options.details || 'En attente',
                state: options.state,
                startTimestamp: options.startTimestamp || this.startTimestamp,
                instance: false,
                buttons: options.buttons || [
                    {
                        label: "Rejoindre le serveur Discord",
                        url: "https://discord.gg/elysia"
                    }
                ]
            };

            // Envoyer la mise à jour
            this.rpc.setActivity(presence);
            return true;
        } catch (error) {
            console.error('Erreur lors de la mise à jour de la Rich Presence:', error);
            return false;
        }
    }

    /**
     * Définit le statut "En jeu"
     * @param {Object} gameInfo - Informations sur le jeu
     */
    setPlaying(gameInfo = {}) {
        this.startTimestamp = Date.now();
        this.serverDetails = gameInfo.serverName;
        
        const options = {
            details: `Joue sur ${gameInfo.serverName || 'Elysia'}`,
            state: gameInfo.gameVersion || 'Minecraft',
            largeImageKey: 'elysia_game',
            largeImageText: 'Elysia Minecraft',
            smallImageKey: 'minecraft',
            smallImageText: gameInfo.gameVersion || 'Minecraft',
            startTimestamp: this.startTimestamp
        };

        return this.updatePresence(options);
    }

    /**
     * Définit le statut "Dans le launcher"
     */
    setInLauncher() {
        this.startTimestamp = Date.now();
        
        const options = {
            details: 'Dans le launcher',
            state: 'En préparation',
            largeImageKey: 'elysia_icon',
            largeImageText: 'Elysia Launcher',
            startTimestamp: this.startTimestamp
        };

        return this.updatePresence(options);
    }

    /**
     * Définit le statut personnalisé
     * @param {Object} options - Options personnalisées
     */
    setCustomStatus(options) {
        return this.updatePresence(options);
    }

    /**
     * Déconnecte le client RPC
     */
    disconnect() {
        if (this.connected) {
            try {
                this.rpc.destroy();
                this.connected = false;
                return true;
            } catch (error) {
                console.error('Erreur lors de la déconnexion de Discord RPC:', error);
                return false;
            }
        }
        return false;
    }
}

module.exports = DiscordRPCManager; 