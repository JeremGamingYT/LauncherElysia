const { ipcRenderer } = require('electron');

// Éléments DOM essentiels
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

// Fonction pour mettre à jour l'interface pendant le lancement
function updateLaunchUI(loading = false, message = '') {
    if (loading) {
        launchButton.disabled = true;
        progressBar.style.width = '100%';
        progressBar.style.transition = 'width 15s linear';
        if (message) statusText.textContent = message;
    } else {
        launchButton.disabled = false;
        progressBar.style.width = '0%';
        progressBar.style.transition = 'none';
    }
}

// Fonction pour mettre à jour l'interface utilisateur après l'authentification
function updateAuthUI(profile) {
    if (!profile) return;
    
    isAuthenticated = true;
    currentUser = profile;
    
    // Mise à jour du profil
    usernameInput.value = profile.name;
    usernameInput.disabled = true;
    avatar.style.backgroundImage = `url('https://minotar.net/avatar/${profile.name}/80')`;
    avatarStatus.classList.add('online');
    logoutBtn.style.display = 'flex';
    
    // Mise à jour du bouton de lancement
    launchButton.textContent = 'JOUER';
    statusText.textContent = 'Prêt à jouer';
}

// Fonction pour réinitialiser l'interface utilisateur
function resetAuthUI() {
    isAuthenticated = false;
    currentUser = null;
    
    // Réinitialisation du profil
    usernameInput.value = 'Non connecté';
    usernameInput.disabled = true;
    avatar.style.backgroundImage = `url('https://minotar.net/avatar/steve/80')`;
    avatarStatus.classList.remove('online');
    logoutBtn.style.display = 'none';
    
    // Réinitialisation du bouton de lancement
    launchButton.textContent = 'SE CONNECTER';
    statusText.textContent = 'Connectez-vous pour jouer';
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
        case 'installing-resources':
            statusText.textContent = data.message || 'Installation des ressources...';
            console.log('Installation des ressources...');
            break;
        case 'installing-resourcepack':
            statusText.textContent = data.message || 'Installation du pack de ressources...';
            console.log('Installation du pack de ressources:', data.message);
            break;
        case 'resourcepack-progress':
            statusText.textContent = `Installation du pack de ressources : ${data.progress}%`;
            progressBar.style.width = `${data.progress}%`;
            console.log('Progression du pack de ressources:', data.progress + '%');
            break;
        case 'installing-shader':
            statusText.textContent = data.message || 'Installation du shader...';
            console.log('Installation du shader:', data.message);
            break;
        case 'shader-progress':
            statusText.textContent = `Installation du shader : ${data.progress}%`;
            progressBar.style.width = `${data.progress}%`;
            console.log('Progression du shader:', data.progress + '%');
            break;
        default:
            statusText.textContent = 'Installation en cours...';
    }
});

// Supprimer la vérification du localStorage et ajouter cet écouteur
ipcRenderer.on('auth-status-update', (event, data) => {
    console.log('Réception de l\'état d\'authentification:', data);
    if (data.isAuthenticated && data.profile) {
        updateAuthUI(data.profile);
    } else {
        resetAuthUI();
    }
});

// Gestion du bouton de déconnexion
logoutBtn.addEventListener('click', async () => {
    try {
        await ipcRenderer.invoke('logout');
        resetAuthUI();
    } catch (error) {
        console.error('Erreur lors de la déconnexion:', error);
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

// Modifier la fonction de lancement du jeu
launchButton.addEventListener('click', async () => {
    try {
        if (!isAuthenticated) {
            // Lancement de l'authentification Microsoft
            updateLaunchUI(true, 'Connexion à Microsoft...');
            const result = await ipcRenderer.invoke('microsoft-login');
            
            if (!result.success) {
                throw new Error(result.error || 'Erreur lors de la connexion');
            }

            // Mise à jour de l'interface avec le nouveau profil
            updateAuthUI(result.profile);
            
            // Sauvegarder l'état dans le localStorage
            localStorage.setItem('lastAuthState', JSON.stringify({
                isAuthenticated: true,
                profile: result.profile,
                timestamp: Date.now()
            }));

            updateLaunchUI(false);
            return;
        }

        // Lancement du jeu avec les paramètres
        updateLaunchUI(true, 'Lancement du jeu...');
        const result = await ipcRenderer.invoke('launch-minecraft', {
            maxMemory: `${memorySlider.value}G`,
            minMemory: "1G",
            version: versionSelect.value
        });
        
        if (!result.success) {
            throw new Error(result.error || 'Erreur lors du lancement');
        }

        statusText.textContent = 'Minecraft est en cours d\'exécution';
        isGameRunning = true;
    } catch (error) {
        console.error('Erreur:', error);
        alert(`Erreur: ${error.message}`);
        updateLaunchUI(false);
    }
});

// Initialisation de l'interface
updateLaunchUI(false);

// Ajouter au début du fichier avec les autres sélecteurs DOM
const navItems = document.querySelectorAll('.nav-item');
const pages = {
    home: document.getElementById('home-page'),
    play: document.getElementById('play-page'),
    news: document.getElementById('news-page'),
    settings: document.getElementById('settings-page')
};

// Mettre à jour la logique de navigation
navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Retirer la classe active de tous les items
        navItems.forEach(nav => nav.classList.remove('active'));
        
        // Ajouter la classe active à l'item cliqué
        item.classList.add('active');
        
        // Cacher toutes les pages
        Object.values(pages).forEach(page => {
            if (page) page.style.display = 'none';
        });
        
        // Afficher la page correspondante
        const pageId = item.getAttribute('href').replace('#', '');
        const pageToShow = pageId === 'home' ? pages.home : 
                          pageId === 'play' ? pages.play : 
                          pageId === 'news' ? pages.news : 
                          pageId === 'settings' ? pages.settings : null;
        
        if (pageToShow) {
            pageToShow.style.display = 'block';
        }
    });
});

// Initialisation : afficher la page d'accueil
document.addEventListener('DOMContentLoaded', () => {
    // L'état d'authentification sera géré par l'événement 'auth-status-update'
    console.log('Application chargée, en attente de l\'état d\'authentification...');
});

// Ajouter la gestion des événements pour les paramètres
memorySlider.addEventListener('input', (e) => {
    memoryValue.textContent = `${e.target.value} Go`;
});

// Mettre à jour la gestion du chemin du jeu
browseBtn.addEventListener('click', async () => {
    try {
        const result = await ipcRenderer.invoke('select-game-path');
        if (result.success) {
            gamePathInput.value = result.path;
        }
    } catch (error) {
        console.error('Erreur lors de la sélection du dossier:', error);
        alert('Erreur lors de la sélection du dossier');
    }
});

resetPathBtn.addEventListener('click', async () => {
    try {
        const defaultPath = await ipcRenderer.invoke('reset-game-path');
        gamePathInput.value = defaultPath;
    } catch (error) {
        console.error('Erreur lors de la réinitialisation du chemin:', error);
    }
});

// Ajouter avec les autres écouteurs
ipcRenderer.on('game-path', (event, path) => {
    gamePathInput.value = path;
});