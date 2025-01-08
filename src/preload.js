contextBridge.exposeInMainWorld('api', {
    invoke: (channel, data) => {
        const validChannels = [
            'launch-minecraft',
            'install-forge',
            'select-directory',
            'reset-directory',
            'microsoft-login',
            'microsoft-logout'
        ];
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, data);
        }
    },
}); 