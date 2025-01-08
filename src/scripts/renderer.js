const { ipcRenderer } = require('electron');

// Éléments DOM
const launchButton = document.getElementById('launch-btn');
const usernameInput = document.getElementById('username');
const versionSelect = document.getElementById('version');
const memorySlider = document.getElementById('memory-slider');
const memoryValue = document.getElementById('memory-value');
const progressBar = document.querySelector('.progress');
const statusText = document.querySelector('.status-text');
const minimizeBtn = document.querySelector('.minimize-btn');
const closeBtn = document.querySelector('.close-btn');
const avatar = document.querySelector('.avatar');
const avatarStatus = document.querySelector('.avatar-status');
const logoutBtn = document.getElementById('logout-btn');
const gamePathInput = document.getElementById('game-path');
const browseBtn = document.getElementById('browse-btn');
const resetPathBtn = document.getElementById('reset-path');

// États
let isAuthenticated = false;
let currentUser = null;
let isGameRunning = false;

// Gestion des contrôles de fenêtre
minimizeBtn.addEventListener('click', () => {
    ipcRenderer.send('minimize-window');
});

closeBtn.addEventListener('click', () => {
    ipcRenderer.send('close-window');
});

// Gestion du slider de mémoire
memorySlider.addEventListener('input', (e) => {
    const value = e.target.value;
    memoryValue.textContent = value;
    
    // Animation du slider
    const percent = ((value - memorySlider.min) / (memorySlider.max - memorySlider.min)) * 100;
    memorySlider.style.background = `linear-gradient(to right, var(--primary) ${percent}%, var(--bg-light) ${percent}%)`;
});

// Initialisation du slider
const initSlider = () => {
    const value = memorySlider.value;
    const percent = ((value - memorySlider.min) / (memorySlider.max - memorySlider.min)) * 100;
    memorySlider.style.background = `linear-gradient(to right, var(--primary) ${percent}%, var(--bg-light) ${percent}%)`;
};

// Fonction pour mettre à jour l'interface pendant le lancement
function updateLaunchUI(isLaunching, status = '') {
    console.log('updateLaunchUI called:', { isLaunching, isGameRunning, isAuthenticated });
    
    if (isLaunching) {
        launchButton.disabled = true;
        launchButton.textContent = 'LANCEMENT...';
        progressBar.parentElement.classList.add('downloading');
        statusText.textContent = status || 'Téléchargement des fichiers...';
    } else {
        launchButton.disabled = isGameRunning;
        launchButton.textContent = isAuthenticated ? (isGameRunning ? 'EN COURS...' : 'JOUER') : 'SE CONNECTER';
        progressBar.parentElement.classList.remove('downloading');
        statusText.textContent = isAuthenticated ? 
            (isGameRunning ? 'Minecraft est en cours d\'exécution' : 'Prêt à jouer') : 
            'Connectez-vous pour jouer';
        progressBar.style.width = '0%';
    }
    console.log('UI updated:', { 
        buttonText: launchButton.textContent,
        buttonDisabled: launchButton.disabled,
        statusText: statusText.textContent
    });
}

// Fonction pour mettre à jour l'interface utilisateur après l'authentification
function updateAuthUI(profile) {
    isAuthenticated = true;
    currentUser = profile;
    usernameInput.value = profile.name;
    usernameInput.disabled = true;
    avatar.style.backgroundImage = `url('https://minotar.net/avatar/${profile.name}')`;
    avatarStatus.classList.add('online');
    logoutBtn.style.display = 'flex';
    updateLaunchUI(false);
}

// Fonction pour réinitialiser l'interface utilisateur après la déconnexion
function resetAuthUI() {
    isAuthenticated = false;
    currentUser = null;
    usernameInput.value = '';
    usernameInput.disabled = true;
    avatar.style.backgroundImage = `url('https://minotar.net/avatar/steve')`;
    avatarStatus.classList.remove('online');
    logoutBtn.style.display = 'none';
    updateLaunchUI(false);
}

// Gestion des événements du jeu
ipcRenderer.on('game-started', () => {
    console.log('Événement game-started reçu');
    isGameRunning = true;
    updateLaunchUI(false);

    // Désactiver les contrôles pendant que le jeu est en cours
    versionSelect.disabled = true;
    memorySlider.disabled = true;
    browseBtn.disabled = true;
    resetPathBtn.disabled = true;

    statusText.textContent = 'Minecraft est en cours d\'exécution';
    console.log('État après game-started:', { isGameRunning, isAuthenticated });
});

// Gestion de la fermeture du jeu
ipcRenderer.on('game-closed', (event, code) => {
    console.log('Événement game-closed reçu avec le code:', code);
    isGameRunning = false;
    updateLaunchUI(false);

    // Réactiver les contrôles
    versionSelect.disabled = false;
    memorySlider.disabled = false;
    browseBtn.disabled = false;
    resetPathBtn.disabled = false;

    statusText.textContent = 'Prêt à jouer';
    console.log('État après game-closed:', { isGameRunning, isAuthenticated });

    // Optionnellement, informer l'utilisateur si le jeu s'est fermé de manière inattendue
    if (code !== 0 && code !== null) {
        alert(`Le jeu s'est fermé avec le code de sortie ${code}`);
    }
});

// Gestion des événements de progression
ipcRenderer.on('install-progress', (event, data) => {
    const statusText = document.querySelector('.status-text');
    const progressBar = document.querySelector('.progress');

    switch (data.stage) {
        case 'installing-vanilla':
            statusText.textContent = data.message || 'Installation de Minecraft...';
            if (data.data) {
                console.log('Installation Vanilla progress:', data.data);
            }
            break;
        case 'downloading-forge':
            statusText.textContent = data.message || 'Téléchargement de Forge...';
            break;
        case 'installing-forge':
            statusText.textContent = data.message || 'Installation de Forge...';
            if (data.data) {
                console.log('Installation Forge progress:', data.data);
            }
            break;
        case 'installing-mods':
            statusText.textContent = data.message || 'Installation des mods...';
            break;
        case 'downloading-mod':
            statusText.textContent = `Téléchargement du mod : ${data.modName}`;
            break;
        case 'mod-progress':
            statusText.textContent = `Installation des mods : ${data.progress}%`;
            progressBar.style.width = `${data.progress}%`;
            break;
        default:
            statusText.textContent = 'Installation en cours...';
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
            gamePathInput.style.borderColor = 'var(--success)';
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
            gamePathInput.style.borderColor = 'var(--success)';
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
    if (isGameRunning) {
        alert('Veuillez fermer le jeu avant de vous déconnecter');
        return;
    }

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

// Fonction améliorée pour installer Forge
async function installForge() {
    try {
        const progressBar = document.querySelector('.progress');
        const statusText = document.querySelector('.status-text');
        const launchButton = document.getElementById('launch-btn');

        // Désactiver le bouton pendant l'installation
        launchButton.disabled = true;
        progressBar.style.width = '0%';
        statusText.textContent = 'Préparation de l\'installation...';

        const result = await ipcRenderer.invoke('install-forge');
        
        if (!result.success) {
            throw new Error(result.error || 'Échec de l\'installation de Forge');
        }

        statusText.textContent = 'Installation terminée avec succès';
        progressBar.style.width = '100%';
        return true;
    } catch (error) {
        console.error('Erreur lors de l\'installation de Forge:', error);
        const statusText = document.querySelector('.status-text');
        statusText.textContent = `Erreur: ${error.message}`;
        return false;
    } finally {
        // Réactiver le bouton
        const launchButton = document.getElementById('launch-btn');
        launchButton.disabled = false;
    }
}

// Modify the launch function to handle Forge
async function launchGame() {
    try {
        // First ensure Forge is installed
        const forgeInstalled = await installForge();
        if (!forgeInstalled) {
            throw new Error('Échec de l\'installation de Forge');
        }

        // Launch with Forge
        const result = await ipcRenderer.invoke('launch-minecraft', {
            maxMemory: memorySlider.value + "G",
            minMemory: "1G"
        });

        if (!result.success) {
            throw new Error(result.error || 'Échec du lancement du jeu');
        }

        // Update UI to show game is running
        launchButton.disabled = true;
        launchButton.textContent = 'JEU EN COURS...';
    } catch (error) {
        console.error('Erreur lors du lancement du jeu:', error);
        alert('Erreur lors du lancement du jeu: ' + error.message);
    }
}

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

        // Installation du jeu si nécessaire
        const installResult = await ipcRenderer.invoke('install-game');
        if (!installResult.success) {
            throw new Error(installResult.message || 'Erreur lors de l\'installation');
        }

        // Lancement du jeu
        updateLaunchUI(true, 'Lancement du jeu...');
        const options = {
            version: versionSelect.value,
            maxMemory: `${memorySlider.value}G`,
            minMemory: '1G'
        };

        const result = await ipcRenderer.invoke('launch-minecraft', options);
        
        if (!result.success) {
            throw new Error(result.error || 'Erreur lors du lancement');
        }

        statusText.textContent = 'Minecraft est en cours d\'exécution';
        isGameRunning = true;
        updateLaunchUI(false);
    } catch (error) {
        alert(`Erreur: ${error.message}`);
        updateLaunchUI(false);
    }
});

// Initialisation de l'interface
updateLaunchUI(false);
initSlider();