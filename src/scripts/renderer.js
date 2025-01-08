const { ipcRenderer } = require('electron');

// Éléments DOM
const launchButton = document.getElementById('launch-btn');
const usernameInput = document.getElementById('username');
const versionSelect = document.getElementById('version');
const memorySelect = document.getElementById('memory');
const progressBar = document.querySelector('.progress');
const statusText = document.querySelector('.status-text');
const minimizeBtn = document.querySelector('.minimize-btn');
const closeBtn = document.querySelector('.close-btn');
const avatar = document.querySelector('.avatar');
const logoutBtn = document.getElementById('logout-btn');
const gamePathInput = document.getElementById('game-path');
const browseBtn = document.getElementById('browse-btn');
const resetPathBtn = document.getElementById('reset-path');

// État de l'authentification
let isAuthenticated = false;
let currentUser = null;

// Gestion des contrôles de fenêtre
minimizeBtn.addEventListener('click', () => {
    ipcRenderer.send('minimize-window');
});

closeBtn.addEventListener('click', () => {
    ipcRenderer.send('close-window');
});

// Fonction pour mettre à jour l'interface pendant le lancement
function updateLaunchUI(isLaunching, status = '') {
    if (isLaunching) {
        launchButton.disabled = true;
        launchButton.textContent = 'LANCEMENT...';
        progressBar.parentElement.classList.add('downloading');
        statusText.textContent = status || 'Téléchargement des fichiers...';
    } else {
        launchButton.disabled = false;
        launchButton.textContent = isAuthenticated ? 'JOUER' : 'SE CONNECTER';
        progressBar.parentElement.classList.remove('downloading');
        statusText.textContent = isAuthenticated ? 'Prêt à jouer' : 'Connectez-vous pour jouer';
        progressBar.style.width = '0%';
    }
}

// Fonction pour mettre à jour l'interface utilisateur après l'authentification
function updateAuthUI(profile) {
    isAuthenticated = true;
    currentUser = profile;
    usernameInput.value = profile.name;
    usernameInput.disabled = true;
    avatar.style.backgroundImage = `url('https://minotar.net/avatar/${profile.name}')`;
    logoutBtn.style.display = 'block';
    updateLaunchUI(false);
}

// Fonction pour réinitialiser l'interface utilisateur après la déconnexion
function resetAuthUI() {
    isAuthenticated = false;
    currentUser = null;
    usernameInput.value = '';
    usernameInput.disabled = true;
    avatar.style.backgroundImage = `url('https://minotar.net/avatar/steve')`;
    logoutBtn.style.display = 'none';
    updateLaunchUI(false);
}

// Gestion de la progression du téléchargement
ipcRenderer.on('download-progress', (event, progress) => {
    if (progress.type === 'download') {
        const percentage = ((progress.current / progress.total) * 100).toFixed(0);
        progressBar.style.width = `${percentage}%`;
        statusText.textContent = `Téléchargement: ${percentage}% - ${progress.name || 'fichiers du jeu'}`;
    }
});

// Vérification du statut d'authentification au démarrage
ipcRenderer.on('auth-status', (event, data) => {
    if (data.isAuthenticated && data.profile) {
        updateAuthUI(data.profile);
    }
});

// Réception du chemin du jeu
ipcRenderer.on('game-path', (event, path) => {
    gamePathInput.value = path;
});

// Gestion du bouton de sélection du dossier
browseBtn.addEventListener('click', async () => {
    try {
        const result = await ipcRenderer.invoke('select-directory');
        if (result.success) {
            gamePathInput.value = result.path;
            // Animation de confirmation
            gamePathInput.style.borderColor = '#55ff55';
            setTimeout(() => {
                gamePathInput.style.borderColor = '';
            }, 1000);
        }
    } catch (error) {
        alert('Erreur lors de la sélection du dossier');
    }
});

// Gestion du bouton de réinitialisation du chemin
resetPathBtn.addEventListener('click', async () => {
    try {
        const result = await ipcRenderer.invoke('reset-directory');
        if (result.success) {
            gamePathInput.value = result.path;
            // Animation de confirmation
            gamePathInput.style.borderColor = '#55ff55';
            setTimeout(() => {
                gamePathInput.style.borderColor = '';
            }, 1000);
        }
    } catch (error) {
        alert('Erreur lors de la réinitialisation du chemin');
    }
});

// Gestion du bouton de déconnexion
logoutBtn.addEventListener('click', async () => {
    try {
        const result = await ipcRenderer.invoke('logout');
        if (result.success) {
            resetAuthUI();
        } else {
            throw new Error(result.error || 'Erreur lors de la déconnexion');
        }
    } catch (error) {
        alert(`Erreur: ${error.message}`);
    }
});

// Gestion du lancement du jeu
launchButton.addEventListener('click', async () => {
    try {
        if (!isAuthenticated) {
            // Lancement de l'authentification Microsoft
            updateLaunchUI(true, 'Connexion à Microsoft...');
            const result = await ipcRenderer.invoke('microsoft-login');
            
            if (!result.success) {
                throw new Error(result.error || 'Erreur lors de la connexion');
            }

            updateAuthUI(result.profile);
            return;
        }

        // Lancement du jeu
        updateLaunchUI(true);
        const options = {
            version: versionSelect.value,
            maxMemory: `${memorySelect.value}G`,
            minMemory: '1G'
        };

        const result = await ipcRenderer.invoke('launch-minecraft', options);
        
        if (!result.success) {
            throw new Error(result.error || 'Erreur lors du lancement');
        }

        statusText.textContent = 'Minecraft est en cours d\'exécution...';
    } catch (error) {
        alert(`Erreur: ${error.message}`);
        updateLaunchUI(false);
    }
});

// Initialisation de l'interface
updateLaunchUI(false);