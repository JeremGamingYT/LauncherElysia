const { ipcRenderer } = require('electron');
const path = require('path');

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
const uninstallBtn = document.getElementById('uninstall-btn');

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
function updateLaunchUI(stage = 'idle', status = '') {
    console.log('updateLaunchUI called:', stage, status);
    
    const states = {
        'auth': {
            button: 'CONNEXION...',
            status: 'Authentification en cours',
            progress: 25
        },
        'install': {
            button: 'INSTALLATION...',
            status: 'Installation des composants',
            progress: 50
        },
        'download': {
            button: 'TÉLÉCHARGEMENT...',
            status: 'Téléchargement des fichiers',
            progress: 75
        },
        'launch': {
            button: 'LANCEMENT...',
            status: 'Démarrage du jeu',
            progress: 90
        },
        'idle': {
            button: isAuthenticated ? (isGameRunning ? 'EN COURS...' : 'JOUER') : 'SE CONNECTER',
            status: isAuthenticated ? 
                (isGameRunning ? 'Minecraft est en cours d\'exécution' : 'Prêt à jouer') : 
                'Connectez-vous pour jouer',
            progress: 0
        }
    };

    const currentState = states[stage] || states.idle;
    
    launchButton.textContent = currentState.button;
    statusText.textContent = status || currentState.status;
    launchButton.disabled = !['idle', 'error'].includes(stage);
    
    // Animation de la barre de progression
    if (stage !== 'idle') {
        progressBar.style.width = `${currentState.progress}%`;
        progressBar.parentElement.classList.add('active');
    } else {
        progressBar.style.width = '0%';
        progressBar.parentElement.classList.remove('active');
    }
    
    console.log('UI updated:', currentState);
}

// Fonction pour mettre à jour l'interface utilisateur après l'authentification
async function updateAuthUI(profile) {
    isAuthenticated = true;
    currentUser = profile;
    usernameInput.value = profile.name;
    usernameInput.disabled = true;
    avatar.style.backgroundImage = `url('https://minotar.net/avatar/${profile.name}')`;
    avatarStatus.classList.add('online');
    logoutBtn.style.display = 'flex';
    updateLaunchUI('idle');
    updateGameStats();
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
    updateLaunchUI('idle');
    
    // S'assurer que la page de jeu reste visible si c'est celle qui est actuellement active
    const activePage = document.querySelector('.nav-btn.active');
    if (activePage && activePage.dataset.page === 'play') {
        document.querySelector('.page-play').style.display = 'flex';
    }
}

// Gestion des événements du jeu
ipcRenderer.on('game-started', () => {
    console.log('Événement game-started reçu');
    isGameRunning = true;
    
    // Mettre à jour l'UI avant de désactiver les contrôles
    updateLaunchUI('idle', 'Lancement réussi !');
    
    // Désactiver les contrôles
    versionSelect.disabled = true;
    memorySlider.disabled = true;
    browseBtn.disabled = true;
    resetPathBtn.disabled = true;

    console.log('État après game-started:', { isGameRunning, isAuthenticated });
});

// Gestion de la fermeture du jeu
ipcRenderer.on('game-closed', (event, code) => {
    console.log('Événement game-closed reçu avec le code:', code);
    isGameRunning = false;
    updateLaunchUI('idle');

    // Réactiver les contrôles
    versionSelect.disabled = false;
    memorySlider.disabled = false;
    browseBtn.disabled = false;
    resetPathBtn.disabled = false;

    statusText.textContent = 'Prêt à jouer';
    console.log('État après game-closed:', { isGameRunning, isAuthenticated });

    // Mettre à jour les statistiques
    updateGameStats();

    // Optionnellement, informer l'utilisateur si le jeu s'est fermé de manière inattendue
    if (code !== 0 && code !== null) {
        alert(`Le jeu s'est fermé avec le code de sortie ${code}`);
    }
});

// Écouter les mises à jour du temps de jeu
ipcRenderer.on('play-time-update', (event, data) => {
    // Mettre à jour l'affichage du temps de jeu
    const playtimeElement = document.getElementById('playtime');
    if (playtimeElement) {
        playtimeElement.textContent = `Temps joué: ${data.formattedTime}`;
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
        case 'launching':
            updateLaunchUI('launch', 'Démarrage du client Minecraft...');
            progressBar.style.width = `${data.progress}%`;
            break;
        case 'verification':
            updateLaunchUI('install', `Vérification des fichiers: ${data.file}`);
            progressBar.style.width = `${data.progress}%`;
            break;
        default:
            statusText.textContent = data.message || 'Installation en cours...';
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

// Gestion des événements de désinstallation
ipcRenderer.on('uninstall-progress', (event, data) => {
    const statusText = document.querySelector('.status-text');
    const progressBar = document.querySelector('.progress');

    switch (data.stage) {
        case 'prepare':
            updateLaunchUI('install', data.message || 'Préparation de la désinstallation...');
            progressBar.style.width = '25%';
            break;
        case 'removing':
            statusText.textContent = data.message || 'Suppression des fichiers...';
            progressBar.style.width = '75%';
            break;
        case 'complete':
            updateLaunchUI('idle', data.message || 'Désinstallation terminée.');
            setTimeout(() => {
                alert('Désinstallation terminée. Le launcher va maintenant se fermer.');
                ipcRenderer.send('close-window');
            }, 2000);
            break;
        case 'error':
            updateLaunchUI('error', data.message || 'Erreur lors de la désinstallation.');
            setTimeout(() => {
                alert('Erreur lors de la désinstallation: ' + data.message);
            }, 1000);
            break;
        default:
            statusText.textContent = data.message || 'Désinstallation en cours...';
    }
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

    // Mémoriser l'onglet actif avant la déconnexion
    const currentActiveTab = document.querySelector('.nav-btn.active');
    const wasOnPlayTab = currentActiveTab && currentActiveTab.dataset.page === 'play';

    try {
        const result = await ipcRenderer.invoke('logout');
        if (result.success) {
            resetAuthUI();
            
            // Rétablir l'onglet "jouer" s'il était actif avant la déconnexion
            if (wasOnPlayTab) {
                // Sélectionner l'onglet jouer
                const playTabButton = document.querySelector('.nav-btn[data-page="play"]');
                if (playTabButton) {
                    // Simuler un clic sur l'onglet jouer
                    playTabButton.click();
                } else {
                    // Fallback au cas où le bouton n'est pas trouvé
                    document.querySelectorAll('.main-content > div').forEach(page => {
                        page.style.display = 'none';
                    });
                    document.querySelector('.page-play').style.display = 'flex';
                }
            }
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
        const result = await ipcRenderer.invoke('install-forge');
        
        if (!result.success) {
            throw new Error(result.error || 'Échec de l\'installation de Forge');
        }

        return true;
    } catch (error) {
        console.error('Erreur lors de l\'installation de Forge:', error);
        const statusText = document.querySelector('.status-text');
        statusText.textContent = `Erreur: ${error.message}`;
        return false;
    }
}

// Gestion du lancement du jeu
launchButton.addEventListener('click', async () => {
    try {
        // Vérifier d'abord si l'utilisateur est authentifié
        if (!isAuthenticated) {
            // Si non authentifié, lancer le processus de connexion Microsoft
            updateLaunchUI('auth', 'Connexion en cours...');
            const authResult = await ipcRenderer.invoke('microsoft-login');
            
            if (!authResult.success) {
                throw new Error(authResult.error || 'Échec de l\'authentification');
            }
            
            // Mise à jour de l'interface avec les infos du profil
            await updateAuthUI(authResult.profile);
            
            // Ne pas lancer le jeu automatiquement après l'authentification
            updateLaunchUI('idle', 'Connexion réussie! Cliquez sur JOUER pour lancer le jeu.');
            return;
        }

        // Si authentifié, lancer le jeu directement
        launchGame();
    } catch (error) {
        console.error('Erreur lancement:', error);
        updateLaunchUI('error', `Erreur: ${error.message}`);
        showErrorModal(`Erreur: ${error.message}`);
    }
});

// Fonction pour lancer le jeu
async function launchGame() {
    try {
        updateLaunchUI('launch', 'Lancement du jeu...');
        const result = await ipcRenderer.invoke('launch-game', {
            username: usernameInput.value,
            version: versionSelect.value,
            memory: memorySlider.value
        });

        if (!result.success) {
            throw new Error(result.error || 'Échec du lancement');
        }
    } catch (error) {
        console.error('Erreur lancement du jeu:', error);
        updateLaunchUI('error', `Erreur: ${error.message}`);
        showErrorModal(`Erreur: ${error.message}`);
    }
}

// Gestion de la navigation entre les pages
document.querySelectorAll('.nav-btn').forEach(button => {
    button.addEventListener('click', () => {
        const page = button.dataset.page;
        
        // Retirer la classe active de tous les boutons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Ajouter la classe active au bouton cliqué
        button.classList.add('active');
        
        // Masquer toutes les pages
        document.querySelectorAll('.main-content > div').forEach(page => {
            // Ajouter une vérification pour éviter l'erreur sur null
            if (page) {
                page.style.display = 'none';
            }
        });
        
        // Afficher la page correspondante
        const targetPage = document.querySelector(`.page-${page}`);
        if (targetPage) {
            targetPage.style.display = 'flex';
        }
    });
});

// Au chargement, afficher la page play par défaut
document.querySelector('.page-play').style.display = 'flex';

// Initialisation de l'interface
updateLaunchUI('idle');
initSlider();

// Ajouter un nouvel événement pour le pré-lancement
ipcRenderer.on('pre-launch', () => {
    updateLaunchUI('launch', 'Finalisation du lancement...');
    // Vérifier que progressBar n'est pas null avant d'accéder à sa propriété style
    if (progressBar) {
        progressBar.style.width = '95%';
    }
});

// Nouvelle fonction pour mettre à jour les stats
async function updateGameStats() {
    try {
        const stats = await ipcRenderer.invoke('get-game-stats');
        const playtimeElement = document.getElementById('playtime');
        const versionElement = document.getElementById('game-version');
        
        if (playtimeElement) {
            playtimeElement.textContent = `Temps joué: ${formatPlayTime(stats.playTime)}`;
        }
        
        if (versionElement) {
            versionElement.textContent = `Version: ${stats.version}`;
        }
    } catch (error) {
        console.error('Erreur récupération stats:', error);
    }
}

// Fonction de formatage du temps
function formatPlayTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

// Mettre à jour les statistiques toutes les minutes
setInterval(updateGameStats, 60000);

// Appeler updateGameStats au chargement
document.addEventListener('DOMContentLoaded', updateGameStats);

// Ajouter un gestionnaire pour le bouton de désinstallation
if (uninstallBtn) {
    uninstallBtn.addEventListener('click', async () => {
        if (confirm('Êtes-vous sûr de vouloir désinstaller complètement Elysia et tous les fichiers associés? Cette action est irréversible.')) {
            try {
                // Informer l'utilisateur
                statusText.textContent = 'Lancement du désinstallateur...';
                statusText.classList.add('status-text-animation');
                
                const result = await ipcRenderer.invoke('uninstall-launcher');
                if (!result) {
                    alert('Le désinstallateur n\'a pas pu être lancé. Veuillez désinstaller manuellement depuis le Panneau de configuration Windows.');
                }
            } catch (error) {
                console.error('Erreur lors de la désinstallation:', error);
                alert('Erreur lors de la désinstallation: ' + error.message);
            }
        }
    });
}

// Fonctions pour les actualités et mises à jour
async function fetchDiscordNews() {
    try {
        const newsContainer = document.querySelector('.news-container');
        if (!newsContainer) return;

        // Afficher un message de chargement
        newsContainer.innerHTML = '<div class="loading">Chargement des actualités...</div>';

        const result = await ipcRenderer.invoke('fetch-discord-news');
        
        if (result.success && result.news && result.news.length > 0) {
            // Vider le conteneur
            newsContainer.innerHTML = '';
            
            // Afficher les actualités
            result.news.forEach(item => {
                const newsItem = document.createElement('div');
                newsItem.className = 'news-item';
                
                let imageHtml = '';
                if (item.image) {
                    imageHtml = `
                        <div class="news-image">
                            <img src="${item.image}" alt="${item.title}" loading="lazy">
                        </div>
                    `;
                }
                
                newsItem.innerHTML = `
                    <h3>${item.title}</h3>
                    <div class="news-meta">
                        <span class="news-author">${item.author}</span>
                        <span class="news-date">${new Date(item.timestamp).toLocaleDateString()}</span>
                    </div>
                    <div class="news-content">${item.content}</div>
                    ${imageHtml}
                    <a href="${item.url}" class="news-link" target="_blank">Voir sur Discord</a>
                `;
                
                newsContainer.appendChild(newsItem);
            });
        } else {
            // Afficher un message si aucune actualité
            newsContainer.innerHTML = '<div class="no-content">Aucune actualité disponible pour le moment.</div>';
        }
    } catch (error) {
        console.error('Erreur lors de la récupération des actualités Discord:', error);
        const newsContainer = document.querySelector('.news-container');
        if (newsContainer) {
            newsContainer.innerHTML = '<div class="error">Erreur lors du chargement des actualités.</div>';
        }
    }
}

async function fetchUpdates() {
    try {
        const updatesContainer = document.querySelector('.updates-container');
        if (!updatesContainer) return;

        // Afficher un message de chargement
        updatesContainer.innerHTML = '<div class="loading">Chargement des mises à jour...</div>';

        const result = await ipcRenderer.invoke('fetch-updates');
        
        if (result.success && result.updates && result.updates.length > 0) {
            // Vider le conteneur
            updatesContainer.innerHTML = '';
            
            // Afficher les mises à jour
            result.updates.forEach(item => {
                const updateItem = document.createElement('div');
                updateItem.className = 'update-item';
                
                updateItem.innerHTML = `
                    <div class="update-header">
                        <h3>${item.title}</h3>
                        <span class="update-version">Version: ${item.version || 'N/A'}</span>
                        <span class="update-date">${new Date(item.date).toLocaleDateString()}</span>
                    </div>
                    <div class="update-content">${item.content}</div>
                `;
                
                updatesContainer.appendChild(updateItem);
            });
        } else {
            // Afficher un message si aucune mise à jour
            updatesContainer.innerHTML = '<div class="no-content">Aucune mise à jour disponible pour le moment.</div>';
        }
    } catch (error) {
        console.error('Erreur lors de la récupération des mises à jour:', error);
        const updatesContainer = document.querySelector('.updates-container');
        if (updatesContainer) {
            updatesContainer.innerHTML = '<div class="error">Erreur lors du chargement des mises à jour.</div>';
        }
    }
}

// Charger les actualités et mises à jour lorsque les onglets correspondants sont cliqués
document.querySelectorAll('.nav-btn').forEach(button => {
    button.addEventListener('click', () => {
        const page = button.dataset.page;
        
        if (page === 'news') {
            fetchDiscordNews();
        } else if (page === 'updates') {
            fetchUpdates();
        }
    });
});

// Charger les mises à jour au démarrage (car souvent consultées)
document.addEventListener('DOMContentLoaded', () => {
    fetchUpdates();
    updateGameStats();
});