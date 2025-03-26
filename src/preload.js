const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    invoke: (channel, data) => {
        const validChannels = [
            'launch-minecraft',
            'install-forge',
            'select-directory',
            'reset-directory',
            'microsoft-login',
            'microsoft-logout',
            'fetch-discord-news',
            'fetch-updates'
        ];
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, data);
        }
    },
    on: (channel, callback) => {
        const validChannels = [
            'game-started',
            'game-closed',
            'install-progress',
            'play-time-update',
            'auth-status',
            'game-path',
            'uninstall-progress',
            'pre-launch'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => callback(...args));
        }
    },
    send: (channel, data) => {
        const validChannels = [
            'minimize-window',
            'close-window'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    }
}); 