const { ipcRenderer } = require('electron');
const path = require('path');

// Éléments DOM
const launchButton = document.getElementById('launch-btn');
const usernameInput = document.getElementById('username');
const versionSelect = document.getElementById('version');
const memorySlider = document.getElementById('memory-slider');
const memoryValue = document.getElementById('memory-value');
const progressBar = document.querySelector('.progress');
const statusText = document.getElementById('status-text');
const minimizeBtn = document.querySelector('.minimize-btn');
const closeBtn = document.querySelector('.close-btn');
const avatar = document.querySelector('.avatar');
const avatarStatus = document.querySelector('.avatar-status');
const logoutBtn = document.getElementById('logout-btn');
const gamePathInput = document.getElementById('game-path');
const browseBtn = document.getElementById('browse-btn');
const resetPathBtn = document.getElementById('reset-path');
const uninstallBtn = document.getElementById('uninstall-btn');
const clearCacheBtn = document.getElementById('clear-cache-btn');
const tipBubble = document.getElementById('tip-bubble');
const tipText = document.getElementById('tip-text');
const tipSection = document.getElementById('tips-section');
const notificationBubble = document.getElementById('notification-bubble');
const notificationText = document.getElementById('notification-text');

// États
let isAuthenticated = false;
let isGameRunning = false;
let isLaunching = false;
let currentUser = null;
let currentServerConfig = {
    host: '91.197.6.212', // Adresse du serveur par défaut
    port: 25580           // Port par défaut Minecraft
};
let serverQueryInterval = null; // Variable pour stocker l'intervalle de requête serveur

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
    
    // Sauvegarder la valeur RAM dans le stockage
    ipcRenderer.invoke('save-memory-setting', value);
    
    // Animation du slider
    const percent = ((value - memorySlider.min) / (memorySlider.max - memorySlider.min)) * 100;
    memorySlider.style.background = `linear-gradient(to right, var(--primary) ${percent}%, var(--bg-light) ${percent}%)`;
});

// Gestion du toggle pour FirstPerson mod
const firstPersonToggle = document.getElementById('firstperson-toggle');
const firstPersonStatus = document.getElementById('firstperson-status');

// Vérifier l'état initial du mod FirstPerson
async function checkFirstPersonModStatus() {
    try {
        const result = await ipcRenderer.invoke('get-firstperson-status');
        if (result.success) {
            firstPersonToggle.checked = result.enabled;
            updateFirstPersonStatusText(result.enabled);
        } else {
            console.error("Erreur lors de la vérification du statut du mod:", result.error);
        }
    } catch (error) {
        console.error("Erreur lors de la vérification du statut du mod:", error);
    }
}

// Mettre à jour le texte d'état du mod FirstPerson
function updateFirstPersonStatusText(enabled) {
    firstPersonStatus.textContent = enabled ? "Activé" : "Désactivé";
}

// Gérer le changement d'état du toggle
firstPersonToggle.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    updateFirstPersonStatusText(enabled);
    
    try {
        const result = await ipcRenderer.invoke('toggle-firstperson-mod', enabled);
        if (!result.success) {
            alert(`Erreur lors de la modification du statut du mod: ${result.error}`);
            // Rétablir l'état précédent du toggle
            firstPersonToggle.checked = !enabled;
            updateFirstPersonStatusText(!enabled);
        } else {
            showNotification(`Mod First Person ${enabled ? 'activé' : 'désactivé'} avec succès.`);
        }
    } catch (error) {
        console.error("Erreur lors de la modification du statut du mod:", error);
        alert(`Erreur: ${error.message}`);
        // Rétablir l'état précédent du toggle
        firstPersonToggle.checked = !enabled;
        updateFirstPersonStatusText(!enabled);
    }
});

// Initialisation du slider
const initSlider = () => {
    // Récupérer la valeur RAM sauvegardée
    ipcRenderer.invoke('get-memory-setting').then(savedValue => {
        if (savedValue) {
            memorySlider.value = savedValue;
            memoryValue.textContent = savedValue;
        }
        const value = memorySlider.value;
        const percent = ((value - memorySlider.min) / (memorySlider.max - memorySlider.min)) * 100;
        memorySlider.style.background = `linear-gradient(to right, var(--primary) ${percent}%, var(--bg-light) ${percent}%)`;
    });
};

// Fonction pour mettre à jour l'interface pendant le lancement
function updateLaunchUI(stage = 'idle', status = '') {
    console.log('updateLaunchUI called:', stage, status);
    
    const states = {
        'auth': {
            button: 'CONNEXION...',
            status: 'Authentification en cours',
            progress: 25,
            disabled: true
        },
        'install': {
            button: 'INSTALLATION...',
            status: 'Installation des composants',
            progress: 50,
            disabled: true
        },
        'download': {
            button: 'TÉLÉCHARGEMENT...',
            status: 'Téléchargement des fichiers',
            progress: 75,
            disabled: true
        },
        'launch': {
            button: 'LANCEMENT...',
            status: 'Démarrage du jeu',
            progress: 90,
            disabled: true
        },
        'idle': {
            button: isAuthenticated ? (isGameRunning ? 'EN COURS...' : 'JOUER') : 'SE CONNECTER',
            status: isAuthenticated ? 
                (isGameRunning ? 'Minecraft est en cours d\'exécution' : 'Prêt à jouer') : 
                'Connectez-vous pour jouer',
            progress: 0,
            disabled: isGameRunning
        }
    };

    const currentState = states[stage] || states.idle;
    
    if (launchButton) {
        launchButton.textContent = currentState.button;
        launchButton.disabled = currentState.disabled;
    }
    
    if (statusText) {
        statusText.textContent = status || currentState.status;
    }
    
    // Gérer l'animation de progression dans la pill loading
    const loadingPill = document.querySelector('.pill.loading');
    if (loadingPill) {
        if (stage !== 'idle') {
            loadingPill.classList.add('progress');
        } else {
            loadingPill.classList.remove('progress');
        }
    }
    
    console.log('UI updated:', currentState);
}

// Fonction pour mettre à jour l'interface utilisateur après l'authentification
async function updateAuthUI(profile) {
    isAuthenticated = true;
    currentUser = profile;
    
    // Mettre à jour le nom d'utilisateur dans l'interface
    const usernameElement = document.getElementById('username');
    if (usernameElement) {
        usernameElement.textContent = profile.name;
    }
    
    // Mettre à jour l'avatar
    const avatarElement = document.querySelector('.avatar');
    if (avatarElement) {
        avatarElement.src = `https://minotar.net/avatar/${profile.name}`;
    }
    
    logoutBtn.style.display = 'flex';
    updateLaunchUI('idle');
    updateGameStats();
}

// Fonction pour réinitialiser l'interface utilisateur après la déconnexion
function resetAuthUI() {
    isAuthenticated = false;
    currentUser = null;
    
    // Vérifier chaque élément DOM avant d'y accéder
    if (usernameInput) {
        usernameInput.value = '';
        usernameInput.disabled = true;
    }
    
    // Réinitialiser l'avatar
    if (avatar) {
        avatar.src = 'https://minotar.net/avatar/steve';
    }
    
    if (avatarStatus) {
        avatarStatus.classList.remove('online');
    }
    
    // Réinitialiser les informations de profil dans la barre supérieure
    const profileUsername = document.getElementById('username');
    if (profileUsername) {
        profileUsername.textContent = 'Non connecté';
    }
    
    updateLaunchUI('idle');
    
    // S'assurer que la page de jeu reste visible si c'est celle qui est actuellement active
    const activePage = document.querySelector('.nav-btn.active');
    if (activePage && activePage.dataset.page === 'play') {
        const playPage = document.querySelector('.page-play');
        if (playPage) {
            playPage.style.display = 'flex';
        }
    }
}

// Gestion des événements du jeu
ipcRenderer.on('pre-launch', () => {
    console.log('Événement pre-launch reçu');
    // Assurer que le bouton est désactivé pendant le lancement
    isGameRunning = true; // Considérer que le jeu est en cours de lancement
    updateLaunchUI('launch', 'Finalisation du lancement...');
    
    // Désactiver explicitement le bouton
    if (launchButton) launchButton.disabled = true;
    
    // Désactiver les contrôles
    if (versionSelect) versionSelect.disabled = true;
    if (memorySlider) memorySlider.disabled = true;
    if (browseBtn) browseBtn.disabled = true;
    if (resetPathBtn) resetPathBtn.disabled = true;
    
    // Vérifier que progressBar n'est pas null avant d'accéder à sa propriété style
    if (progressBar) {
        progressBar.style.width = '95%';
    }
});

ipcRenderer.on('game-started', () => {
    console.log('Événement game-started reçu');
    isGameRunning = true;
    
    // Mettre à jour l'UI avant de désactiver les contrôles
    updateLaunchUI('idle', 'Lancement réussi !');
    
    // Désactiver les contrôles
    if (versionSelect) versionSelect.disabled = true;
    if (memorySlider) memorySlider.disabled = true;
    if (browseBtn) browseBtn.disabled = true;
    if (resetPathBtn) resetPathBtn.disabled = true;

    // Forcer la désactivation du bouton
    if (launchButton) launchButton.disabled = true;

    console.log('État après game-started:', { isGameRunning, isAuthenticated });

    // Mettre à jour les statistiques
    updateGameStats();

    // Mettre à jour les statistiques de session quand le jeu démarre
    const sessionCount = parseInt(localStorage.getItem('session-count') || '0') + 1;
    localStorage.setItem('session-count', sessionCount);
    
    // Enregistrer la date et l'heure de la dernière session
    const now = new Date();
    const formattedDate = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    localStorage.setItem('last-session-date', formattedDate);
});

// Gestion de la fermeture du jeu
ipcRenderer.on('game-closed', (event, code) => {
    console.log('Événement game-closed reçu avec le code:', code);
    isGameRunning = false;
    
    // Réactiver les contrôles
    if (versionSelect) versionSelect.disabled = false;
    if (memorySlider) memorySlider.disabled = false;
    if (browseBtn) browseBtn.disabled = false;
    if (resetPathBtn) resetPathBtn.disabled = false;

    // Mettre à jour l'interface
    updateLaunchUI('idle', 'Prêt à jouer');
    
    // S'assurer que le bouton est activé
    if (launchButton) launchButton.disabled = false;

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

// Fonction pour animer un changement de statut
function animateStatusChange(text) {
    const statusText = document.getElementById('status-text');
    const loadingPill = document.querySelector('.pill.loading');
    
    if (!statusText) return;
    
    // Animation de flash pour signaler le changement
    if (loadingPill) {
        loadingPill.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
        setTimeout(() => {
            loadingPill.style.backgroundColor = '';
        }, 300);
    }
    
    // Modifier directement le texte sans animation d'opacité
    statusText.textContent = text;
}

// Gestion des événements de progression avec animation
ipcRenderer.on('install-progress', (event, data) => {
    const loadingPill = document.querySelector('.pill.loading');
    
    // Activer l'animation de progression
    if (loadingPill) {
        loadingPill.classList.add('progress');
    }

    let statusMessage = '';
    
    switch (data.stage) {
        case 'installing-vanilla':
            statusMessage = data.message || 'Installation de Minecraft...';
            if (data.data) {
                console.log('Installation Vanilla progress:', data.data);
            }
            break;
        case 'downloading-forge':
            statusMessage = data.message || 'Téléchargement de Forge...';
            break;
        case 'installing-forge':
            statusMessage = data.message || 'Installation de Forge...';
            if (data.data) {
                console.log('Installation Forge progress:', data.data);
            }
            break;
        case 'installing-mods':
            statusMessage = data.message || 'Installation des mods...';
            break;
        case 'downloading-mod':
            statusMessage = `Téléchargement du mod : ${data.modName}`;
            break;
        case 'mod-progress':
            statusMessage = `Installation des mods : ${data.progress}%`;
            break;
        case 'installing-resources':
            statusMessage = data.message || 'Installation des ressources...';
            console.log('Installation des ressources...');
            break;
        case 'installing-resourcepack':
            statusMessage = data.message || 'Installation du pack de ressources...';
            console.log('Installation du pack de ressources:', data.message);
            break;
        case 'resourcepack-progress':
            statusMessage = `Installation du pack de ressources : ${data.progress}%`;
            console.log('Progression du pack de ressources:', data.progress + '%');
            break;
        case 'installing-shader':
            statusMessage = data.message || 'Installation du shader...';
            console.log('Installation du shader:', data.message);
            break;
        case 'shader-progress':
            statusMessage = `Installation du shader : ${data.progress}%`;
            console.log('Progression du shader:', data.progress + '%');
            break;
        case 'launching':
            updateLaunchUI('launch', 'Démarrage du client Minecraft...');
            return; // updateLaunchUI gère déjà l'UI
            break;
        case 'verification':
            updateLaunchUI('install', `Vérification des fichiers: ${data.file}`);
            return; // updateLaunchUI gère déjà l'UI
            break;
        default:
            statusMessage = data.message || 'Installation en cours...';
    }
    
    // Animer le changement de statut
    animateStatusChange(statusMessage);
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
    const loadingPill = document.querySelector('.pill.loading');

    // Activer l'animation de progression
    if (loadingPill) {
        loadingPill.classList.add('progress');
    }

    let statusMessage = '';
    
    switch (data.stage) {
        case 'prepare':
            updateLaunchUI('install', data.message || 'Préparation de la désinstallation...');
            return; // updateLaunchUI gère déjà l'UI
            break;
        case 'removing':
            statusMessage = data.message || 'Suppression des fichiers...';
            break;
        case 'complete':
            updateLaunchUI('idle', data.message || 'Désinstallation terminée.');
            setTimeout(() => {
                alert('Désinstallation terminée. Le launcher va maintenant se fermer.');
                ipcRenderer.send('close-window');
            }, 2000);
            return; // updateLaunchUI gère déjà l'UI
            break;
        case 'error':
            updateLaunchUI('error', data.message || 'Erreur lors de la désinstallation.');
            setTimeout(() => {
                alert('Erreur lors de la désinstallation: ' + data.message);
            }, 1000);
            return; // updateLaunchUI gère déjà l'UI
            break;
        default:
            statusMessage = data.message || 'Désinstallation en cours...';
    }
    
    // Animer le changement de statut
    animateStatusChange(statusMessage);
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
            showNotification('Chemin du jeu réinitialisé');
        }
    } catch (error) {
        console.error('Erreur lors de la réinitialisation du chemin:', error);
        showNotification('Erreur lors de la réinitialisation du chemin');
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
        const statusText = document.getElementById('status-text');
        statusText.textContent = `Erreur: ${error.message}`;
        return false;
    }
}

// Ajouter un gestionnaire pour le bouton de lancement
function setupLaunchButton() {
    const launchBtn = document.getElementById('launch-btn');
    if (launchBtn) {
        launchBtn.addEventListener('click', async () => {
            if (isAuthenticated) {
                // Si l'utilisateur est authentifié, lancer le jeu
                await launchGame();
            } else {
                // Si l'utilisateur n'est pas authentifié, lancer l'authentification
                try {
                    launchBtn.disabled = true;
                    updateLaunchUI('auth', 'Connexion en cours...');
                    
                    const authResult = await ipcRenderer.invoke('microsoft-login');
                    
                    if (authResult && authResult.success) {
                        // Mettre à jour l'interface avec les données du profil
                        updateAuthUI(authResult.profile);
                        // Ne plus lancer automatiquement le jeu après connexion
                        updateLaunchUI('idle', 'Connecté! Cliquez sur JOUER pour lancer le jeu.');
                        launchBtn.disabled = false;
                    } else {
                        throw new Error(authResult.error || 'Échec de l\'authentification');
                    }
                } catch (error) {
                    console.error('Erreur d\'authentification:', error);
                    updateLaunchUI('idle', 'Erreur: ' + error.message);
                    launchBtn.disabled = false;
                    showErrorModal('Erreur d\'authentification: ' + error.message);
                }
            }
        });
    }
}

// Fonction pour lancer le jeu
async function launchGame() {
    try {
        // Si le jeu est déjà en cours de lancement ou en cours d'exécution, ne rien faire
        if (isGameRunning || launchButton.disabled) {
            console.log('Le jeu est déjà en cours de lancement ou d\'exécution');
            return;
        }
        
        // Mettre à jour l'interface pour indiquer que le lancement est en cours
        updateLaunchUI('launch', 'Lancement du jeu...');
        
        const result = await ipcRenderer.invoke('launch-game', {
            username: usernameInput ? usernameInput.value : '',
            // Utiliser une valeur par défaut au lieu de versionSelect.value
            version: '1.21.1',
            memory: memorySlider ? memorySlider.value : '4'
        });

        if (!result.success) {
            throw new Error(result.error || 'Échec du lancement');
        }
    } catch (error) {
        console.error('Erreur lancement du jeu:', error);
        updateLaunchUI('error', `Erreur: ${error.message}`);
        showErrorModal(`Erreur: ${error.message}`);
        
        // Réinitialiser l'état du bouton en cas d'erreur
        launchButton.disabled = false;
    }
}

// Gestion de la navigation
document.querySelectorAll('.nav a').forEach(button => {
    button.addEventListener('click', () => {
        // Enlever la classe active de tous les liens
        document.querySelectorAll('.nav a').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Ajouter la classe active au lien cliqué
        button.classList.add('active');
    });
});

// Au chargement, afficher la page play par défaut
const pagePlayElement = document.querySelector('.page-play');
if (pagePlayElement) {
    pagePlayElement.style.display = 'flex';
}

// Initialisation de l'interface
updateLaunchUI('idle');
initSlider();
checkFirstPersonModStatus();

// Nouvelle fonction pour mettre à jour les stats
async function updateGameStats() {
    try {
        const stats = await ipcRenderer.invoke('get-game-stats');
        const playtimeElement = document.getElementById('playtime');
        const versionElement = document.getElementById('game-version');
        
        if (playtimeElement) {
            // Afficher simplement "Temps de jeu: --" par défaut
            playtimeElement.textContent = `Temps de jeu: --`;
            
            // Seulement afficher le temps réel si le jeu a déjà été joué et n'est pas en cours d'exécution
            if (!isGameRunning && stats.playTime > 0) {
                playtimeElement.textContent = `Temps joué: ${formatDetailedPlayTime(stats.playTime)}`;
            }
        }
        
        if (versionElement) {
            versionElement.textContent = `Version: ${stats.version}`;
        }
    } catch (error) {
        console.error('Erreur récupération stats:', error);
    }
}

// Formatage plus détaillé du temps de jeu
function formatDetailedPlayTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
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
    
    // Tester la notification avec un léger délai
    setTimeout(() => {
        showNotification('Bienvenue sur Elysia !');
    }, 1000);
});

// Gestion du bouton "Vider le cache"
clearCacheBtn.addEventListener('click', async () => {
    if (confirm('Êtes-vous sûr de vouloir vider le cache et réinitialiser le dossier .elysia ? Cela supprimera tous les fichiers téléchargés et nécessitera une réinstallation lors du prochain lancement.')) {
        try {
            updateLaunchUI('install', 'Nettoyage complet en cours...');
            
            console.log("Envoi de la demande de nettoyage du cache");
            const result = await ipcRenderer.invoke('clear-cache');
            console.log("Résultat reçu:", result);
            
            if (result.success) {
                showNotification('Cache et dossier .elysia vidés avec succès ! Les fichiers seront réinstallés au prochain lancement.');
            } else {
                showNotification(`Erreur: ${result.error || 'Impossible de vider le cache'}`);
            }
            
            setTimeout(() => {
                updateLaunchUI('idle');
            }, 1000);
        } catch (error) {
            console.error('Erreur lors du vidage du cache:', error);
            showNotification(`Erreur: ${error.message}`);
            
            setTimeout(() => {
                updateLaunchUI('idle');
            }, 1000);
        }
    }
});

// Système d'astuces
const tips = [
    "N'oublie pas de protéger ta base avant de te déconnecter !",
    "Tu peux utiliser la touche F3 pour afficher les coordonnées en jeu.",
    "Pense à faire des sauvegardes régulières de tes mondes.",
    "Augmente la mémoire RAM pour améliorer les performances du jeu.",
    "Utilise F11 pour passer en mode plein écran."
];

// Fonction pour afficher une astuce aléatoire
function showRandomTip() {
    // S'assurer que les éléments existent
    if (!tipSection || !tipText) return;
    
    // Choisir une astuce aléatoire
    const randomTip = tips[Math.floor(Math.random() * tips.length)];
    
    // Mettre à jour le texte
    tipText.textContent = randomTip;
    
    // Forcer le recalcul des dimensions
    setTimeout(() => {
        // Afficher l'astuce
        tipSection.classList.add('visible');
        
        // Masquer l'astuce après un délai
        setTimeout(() => {
            tipSection.classList.remove('visible');
        }, 8000);
    }, 10);
}

// Afficher une astuce au démarrage après un court délai
setTimeout(showRandomTip, 2000);

// Afficher une astuce toutes les 5 minutes
setInterval(showRandomTip, 300000);

// Fonction pour afficher une notification
function showNotification(message, duration = 5000) {
    if (!notificationBubble || !notificationText) return;
    
    notificationText.textContent = message;
    
    setTimeout(() => {
        notificationBubble.classList.add('visible');
        
        setTimeout(() => {
            notificationBubble.classList.remove('visible');
        }, duration);
    }, 10);
}

// Effet de survol sur la zone de contenu principal
const mainContent = document.querySelector('.main-content');

if (mainContent) {
    mainContent.addEventListener('mousemove', (e) => {
        // Calculer la position relative de la souris
        const rect = mainContent.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Mettre à jour les variables CSS utilisées pour le gradient
        mainContent.style.setProperty('--x', `${(x / rect.width) * 100}%`);
        mainContent.style.setProperty('--y', `${(y / rect.height) * 100}%`);
    });
}

// Notification de Java manquant
ipcRenderer.on('java-missing', (event, data) => {
    console.log('Java manquant:', data);
    
    // Créer une notification
    const notification = document.createElement('div');
    notification.className = 'java-notification';
    notification.innerHTML = `
        <div class="java-notification-content">
            <div class="notification-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                    <path d="M12 8v4M12 16h.01"/>
                </svg>
            </div>
            <div class="notification-text">
                <h3>${data.message}</h3>
                <p>${data.details}</p>
            </div>
        </div>
        <button class="install-java-btn">Installer Java 21</button>
    `;
    
    document.body.appendChild(notification);
    
    // Animer l'entrée de la notification
    setTimeout(() => {
        notification.classList.add('visible');
        
        // Supprimer après 3 secondes
        setTimeout(() => {
            notification.classList.remove('visible');
            setTimeout(() => notification.remove(), 3000);
        }, 3000);
    }, 100);
    
    // Gestionnaire de clic pour le bouton d'installation
    const installButton = notification.querySelector('.install-java-btn');
    installButton.addEventListener('click', async () => {
        installButton.disabled = true;
        installButton.textContent = 'Installation en cours...';
        
        try {
            const result = await ipcRenderer.invoke('install-java');
            if (result.success) {
                notification.querySelector('.notification-text h3').textContent = 'Java 21 installé avec succès';
                notification.querySelector('.notification-text p').textContent = 'Vous pouvez maintenant lancer le jeu.';
                installButton.textContent = 'Fermer';
                installButton.addEventListener('click', () => {
                    notification.classList.remove('visible');
                    setTimeout(() => notification.remove(), 300);
                }, { once: true });
            } else {
                notification.querySelector('.notification-text h3').textContent = 'Échec de l\'installation';
                notification.querySelector('.notification-text p').textContent = result.error || 'Une erreur s\'est produite lors de l\'installation de Java.';
                installButton.textContent = 'Réessayer';
                installButton.disabled = false;
            }
        } catch (error) {
            console.error('Erreur lors de l\'installation de Java:', error);
            notification.querySelector('.notification-text h3').textContent = 'Échec de l\'installation';
            notification.querySelector('.notification-text p').textContent = error.message || 'Une erreur s\'est produite lors de l\'installation de Java.';
            installButton.textContent = 'Réessayer';
            installButton.disabled = false;
        }
    });
});

// Notification d'installation de Java réussie
ipcRenderer.on('java-installed', (event, data) => {
    console.log('Java installé:', data);
    
    // Afficher une notification temporaire
    const notification = document.createElement('div');
    notification.className = 'java-success-notification';
    notification.innerHTML = `
        <div class="notification-icon success">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <path d="M22 4L12 14.01l-3-3"/>
            </svg>
        </div>
        <div class="notification-text">
            <h3>${data.message}</h3>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Animer l'entrée de la notification
    setTimeout(() => {
        notification.classList.add('visible');
        
        // Supprimer après 3 secondes
        setTimeout(() => {
            notification.classList.remove('visible');
            setTimeout(() => notification.remove(), 3000);
        }, 3000);
    }, 100);
});

// Fonction pour afficher un modal d'erreur
function showErrorModal(message) {
    const modal = document.createElement('div');
    modal.className = 'error-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close-modal">&times;</span>
            <h3>Erreur</h3>
            <p>${message}</p>
            <button class="modal-btn">OK</button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Fermer le modal quand on clique sur le bouton ou sur la croix
    const closeBtn = modal.querySelector('.close-modal');
    const okBtn = modal.querySelector('.modal-btn');
    
    const closeModal = () => {
        document.body.removeChild(modal);
    };
    
    closeBtn.addEventListener('click', closeModal);
    okBtn.addEventListener('click', closeModal);
}

// Fonctions pour le nouveau design
async function changeServer(serverName, title, description, serverHost = null) {
    // Mettre à jour l'arrière-plan
    const mainElement = document.querySelector('.main');
    if (mainElement) {
        // Obtenir le chemin de l'image de fond
        const bgImageUrl = await getAssetPath('backgrounds', `${serverName}.jpg`);
        console.log(`Setting background to: ${bgImageUrl}`);
        mainElement.style.background = `url('${bgImageUrl}') center/cover no-repeat`;
    }
    
    // Mettre à jour le titre et la description
    const titleElement = document.querySelector('.title');
    const descElement = document.querySelector('.desc');
    const backBtnElement = document.querySelector('.back-btn');
    
    if (titleElement) {
        titleElement.textContent = title.toUpperCase();
    }
    
    if (descElement) {
        descElement.textContent = description;
    }
    
    // Mettre à jour le bouton de retour
    if (backBtnElement) {
        backBtnElement.style.display = 'inline-flex';
    }
    
    // Mettre à jour la configuration du serveur si fournie
    if (serverHost) {
        // Si serverHost contient un port (format host:port)
        if (serverHost.includes(':')) {
            const [host, port] = serverHost.split(':');
            currentServerConfig.host = host;
            currentServerConfig.port = parseInt(port, 10) || 25565;
        } else {
            currentServerConfig.host = serverHost;
            currentServerConfig.port = 25565; // Port par défaut
        }
        
        // Rafraîchir immédiatement le statut du serveur
        updateServerStatus();
    }
    
    // Stocker le serveur sélectionné (uniquement si la méthode existe)
    try {
        console.log(`Attempting to save server selection: ${serverName}`);
        // Vérifier si la méthode existe avant de l'appeler
        if (typeof ipcRenderer.invoke === 'function') {
            // Envelopper dans un try/catch pour éviter les erreurs
            ipcRenderer.invoke('save-server-selection', serverName).catch(err => {
                console.warn('Warning: Failed to save server selection:', err.message);
                // On ne bloque pas l'exécution si ça échoue
            });
        }
    } catch (err) {
        console.warn('Warning: Could not save server selection:', err.message);
        // On ne bloque pas l'exécution si ça échoue
    }
}

// Initialiser le serveur au démarrage
async function initSelectedServer() {
    try {
        // Utiliser elysia par défaut sans appeler get-server-selection
        const serverName = 'elysia';
        console.log(`Serveur sélectionné: ${serverName}`);
        
        // Mettre à jour l'interface pour le serveur sélectionné
        if (serverName === 'elysia') {
            await changeServer(
                'elysia', 
                'ÉLYSIA', 
                'Plongez dans un univers épique de factions où PvP, PvE et événements légendaires forgent votre destinée.',
                '91.197.6.212:25580'  // Adresse avec port correct
            );
        }
    } catch (error) {
        console.error('Erreur lors de l\'initialisation du serveur:', error);
    }
}

// Événement chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    // Initialiser l'application
    initApp();
});

// Fonction d'initialisation de l'application
function initApp() {
    console.log('Initialisation de l\'application');
    
    // Initialiser l'interface
    updateLaunchUI('idle');
    initSlider();
    checkFirstPersonModStatus();
    
    // Configurer le bouton de lancement
    setupLaunchButton();
    
    // Gestionnaire pour les icônes dans la sidebar
    setupNavigationHandlers();
    
    // Initialiser le serveur sélectionné
    initSelectedServer();
    
    // Charger les mises à jour
    fetchUpdates();
    
    // Mettre à jour les statistiques
    updateGameStats();
    
    // Afficher une notification de bienvenue
    setTimeout(() => {
        showNotification('Bienvenue sur Elysia !');
    }, 1000);
    
    // Démarrer les mises à jour du statut du serveur
    startServerStatusUpdates();
}

// Gestionnaires de navigation
function setupNavigationHandlers() {
    console.log('Configuration des gestionnaires de navigation');
    
    // Gestionnaire pour le bouton de retour
    const backBtn = document.querySelector('.back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Clic sur le bouton de retour');
            showServerSelection();
        });
    }
    
    // Appliquer des classes de transition au contenu principal
    const contentElements = document.querySelectorAll('.content, .main');
    contentElements.forEach(el => {
        el.classList.add('content-transition');
    });
    
    // Gestionnaire pour les icônes dans la sidebar
    document.querySelectorAll('.nav a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            console.log(`Clic sur l'onglet ${link.dataset.page}`);
            
            // Enlever la classe active de tous les liens
            document.querySelectorAll('.nav a').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Ajouter la classe active au lien cliqué
            link.classList.add('active');
            
            // Récupérer la page à afficher
            const page = link.dataset.page;
            
            // Transition de sortie pour les pages overlay actuellement affichées
            const activeOverlays = document.querySelectorAll('.page-news.active, .page-updates.active, .page-settings.active');
            activeOverlays.forEach(overlay => {
                overlay.classList.remove('active');
                // Après la transition de sortie, masquer complètement
                setTimeout(() => {
                    overlay.style.display = 'none';
                }, 300); // Correspond à la durée de la transition CSS
            });

            // Afficher la page correspondante avec transition
            if (page === 'home') {
                console.log('Affichage de la page d\'accueil');
                // Ajouter une légère animation au contenu principal
                const content = document.querySelector('.content');
                if (content) {
                    content.style.opacity = '0';
                    content.style.transform = 'translateY(10px)';
                    setTimeout(() => {
                        content.style.opacity = '1';
                        content.style.transform = 'translateY(0)';
                    }, 50);
                }
            } else if (page === 'news') {
                console.log('Affichage de la page Actualités');
                const newsPage = document.querySelector('.page-news');
                if (newsPage) {
                    newsPage.style.display = 'block';
                    // Petit délai pour que la transition soit visible
                    setTimeout(() => {
                        newsPage.classList.add('active');
                    }, 50);
                    fetchDiscordNews();
                }
            } else if (page === 'updates') {
                console.log('Affichage de la page Mises à jour');
                const updatesPage = document.querySelector('.page-updates');
                if (updatesPage) {
                    updatesPage.style.display = 'block';
                    // Petit délai pour que la transition soit visible
                    setTimeout(() => {
                        updatesPage.classList.add('active');
                    }, 50);
                    fetchUpdates();
                }
            } else if (page === 'settings') {
                console.log('Affichage de la page Paramètres');
                const settingsPage = document.querySelector('.page-settings');
                if (settingsPage) {
                    settingsPage.style.display = 'block';
                    // Petit délai pour que la transition soit visible
                    setTimeout(() => {
                        settingsPage.classList.add('active');
                    }, 50);
                }
            }
        });
    });
    
    // Gestionnaire pour le bouton de paramètres dans la page d'accueil
    const configButton = document.querySelector('.btn.config');
    if (configButton) {
        configButton.addEventListener('click', () => {
            console.log('Clic sur le bouton Paramètres');
            
            // Mettre à jour la navigation dans la sidebar
            document.querySelectorAll('.nav a').forEach(btn => {
                btn.classList.remove('active');
            });
            const settingsLink = document.querySelector('.nav a[data-page="settings"]');
            if (settingsLink) {
                settingsLink.classList.add('active');
            }
            
            // Transition de sortie pour les pages overlay actuellement affichées
            const activeOverlays = document.querySelectorAll('.page-news.active, .page-updates.active');
            activeOverlays.forEach(overlay => {
                overlay.classList.remove('active');
                // Après la transition de sortie, masquer complètement
                setTimeout(() => {
                    overlay.style.display = 'none';
                }, 300); // Correspond à la durée de la transition CSS
            });
            
            // Afficher la page des paramètres avec transition
            const settingsPage = document.querySelector('.page-settings');
            if (settingsPage) {
                settingsPage.style.display = 'block';
                // Petit délai pour que la transition soit visible
                setTimeout(() => {
                    settingsPage.classList.add('active');
                }, 50);
            }
        });
    }
}

// Fonction pour afficher une liste de serveurs
async function showServerSelection() {
    console.log('Affichage de la sélection de serveur');
    
    // Obtenir le chemin de l'image de fond
    const bgImageUrl = await getAssetPath('backgrounds', 'classic.png');
    console.log('Background image URL for server selection:', bgImageUrl);
    
    const serverSelectionHTML = `
        <div id="server-selection" class="server-selection">
            <h2>SÉLECTION DE SERVEUR</h2>
            <div class="server-list">
                <div class="server-item" data-server="elysia">
                    <div class="server-bg" style="background-image: url('${bgImageUrl}')"></div>
                    <div class="server-info">
                        <h3>ÉLYSIA</h3>
                        <p>Plongez dans un univers épique de factions où PvP, PvE et événements légendaires forgent votre destinée.</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    const content = document.querySelector('.content');
    
    // Cacher les éléments actuels
    const backBtn = document.querySelector('.back-btn');
    const titleElem = document.querySelector('.title');
    const descElem = document.querySelector('.desc');
    const actionsElem = document.querySelector('.actions');
    const footerElem = document.querySelector('.footer');
    
    if (backBtn) backBtn.style.display = 'none';
    if (titleElem) titleElem.style.display = 'none';
    if (descElem) descElem.style.display = 'none';
    if (actionsElem) actionsElem.style.display = 'none';
    if (footerElem) footerElem.style.display = 'none';
    
    // Ajouter la sélection de serveur
    const serverSelectionElement = document.createElement('div');
    serverSelectionElement.innerHTML = serverSelectionHTML;
    if (content) {
        content.appendChild(serverSelectionElement.firstElementChild);
        
        // Ajouter des gestionnaires d'événements aux serveurs
        document.querySelectorAll('.server-item').forEach(serverItem => {
            serverItem.addEventListener('click', async () => {
                const serverName = serverItem.dataset.server;
                const servers = {
                    'elysia': {
                        title: 'Élysia',
                        description: 'Plongez dans un univers épique de factions où PvP, PvE et événements légendaires forgent votre destinée.'
                    }
                };
                
                // Supprimer la sélection de serveur
                const selectionElem = document.getElementById('server-selection');
                if (selectionElem) {
                    selectionElem.remove();
                }
                
                // Afficher les éléments cachés
                if (backBtn) backBtn.style.display = 'inline-flex';
                if (titleElem) titleElem.style.display = 'block';
                if (descElem) descElem.style.display = 'block';
                if (actionsElem) actionsElem.style.display = 'flex';
                if (footerElem) footerElem.style.display = 'flex';
                
                // Changer le serveur
                await changeServer(serverName, servers[serverName].title, servers[serverName].description);
            });
        });
    }
}

// Log image loading issues
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Checking image loading...');
    
    // Get the base URL for the application
    const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
    console.log('Application base URL:', baseUrl);
    
    // Display all image paths for debugging
    console.log('All image elements on page:');
    document.querySelectorAll('img').forEach(img => {
        console.log(`Image element: src="${img.src}", alt="${img.alt}"`);
    });
    
    // Check logo loading
    const logoImg = document.querySelector('.sidebar .logo img');
    if (logoImg) {
        console.log('Logo element found, current src:', logoImg.src);
        logoImg.addEventListener('load', () => {
            console.log('Logo image loaded successfully');
        });
        logoImg.addEventListener('error', async (e) => {
            console.error('Logo image failed to load:', e);
            console.log('Attempting to fix logo path...');
            
            // Utiliser notre fonction utilitaire pour obtenir le chemin correct
            const logoPath = await getAssetPath('', 'logo.png');
            console.log('Using asset path utility for logo:', logoPath);
            logoImg.src = logoPath;
        });
    } else {
        console.error('Logo element not found in DOM');
    }
    
    // Fix logo path preemptively
    if (logoImg) {
        try {
            console.log('Preemptively fixing logo path...');
            const logoPath = await getAssetPath('', 'logo.png');
            console.log('Using asset path utility for logo:', logoPath);
            logoImg.src = logoPath;
        } catch (err) {
            console.error('Failed to preemptively fix logo path:', err);
        }
    }
    
    // Log all background images in CSS
    console.log('Checking all elements with background-image CSS property:');
    const allElements = document.querySelectorAll('*');
    allElements.forEach(async (el) => {
        const style = window.getComputedStyle(el);
        const bgImage = style.backgroundImage;
        if (bgImage && bgImage !== 'none') {
            console.log(`Element ${el.tagName} has background-image: ${bgImage}`);
            // For server-bg elements specifically
            if (el.classList.contains('server-bg')) {
                console.log('Found server-bg element with background-image:', bgImage);
                // Try to fix server-bg background if it appears to be missing
                if (bgImage === 'none' || bgImage === '') {
                    console.log('Attempting to fix server-bg background...');
                    const bgPath = await getAssetPath('backgrounds', 'classic.png');
                    el.style.backgroundImage = `url("${bgPath}")`;
                }
            }
        }
    });
});

// Ajouter juste après le code de diagnostic pour les images
// Améliorer la navigation dans la sidebar
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initialisation de la navigation de la barre latérale...');
    
    // Obtenir tous les liens de navigation
    const navLinks = document.querySelectorAll('.nav a');
    
    // Vérifier que les liens de navigation sont trouvés
    console.log(`${navLinks.length} liens de navigation trouvés`);
    
    // Enlever les gestionnaires d'événements existants pour éviter les doublons
    navLinks.forEach(link => {
        // Clone l'élément pour supprimer tous les gestionnaires d'événements
        const newLink = link.cloneNode(true);
        link.parentNode.replaceChild(newLink, link);
    });
    
    // Ajouter de nouveaux gestionnaires d'événements
    document.querySelectorAll('.nav a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            const page = link.getAttribute('data-page');
            console.log(`Clic sur l'onglet ${page}`);
            
            // Enlever la classe active de tous les liens
            document.querySelectorAll('.nav a').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Ajouter la classe active au lien cliqué
            link.classList.add('active');
            
            // Récupérer la page à afficher
            handlePageNavigation(page);
        });
    });
});

// Fonction pour gérer la navigation entre les pages
function handlePageNavigation(page) {
    console.log(`Navigation vers la page: ${page}`);
    
    // Transition de sortie pour les pages overlay actuellement affichées
    const activeOverlays = document.querySelectorAll('.page-news.active, .page-updates.active, .page-settings.active');
    activeOverlays.forEach(overlay => {
        overlay.classList.remove('active');
        // Après la transition de sortie, masquer complètement
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 300); // Correspond à la durée de la transition CSS
    });

    // Afficher la page correspondante avec transition
    if (page === 'home') {
        console.log('Affichage de la page d\'accueil');
        // Ajouter une légère animation au contenu principal
        const content = document.querySelector('.content');
        if (content) {
            content.style.opacity = '0';
            content.style.transform = 'translateY(10px)';
            setTimeout(() => {
                content.style.opacity = '1';
                content.style.transform = 'translateY(0)';
            }, 50);
        }
    } else if (page === 'news') {
        console.log('Affichage de la page Actualités');
        const newsPage = document.querySelector('.page-news');
        if (newsPage) {
            newsPage.style.display = 'block';
            // Petit délai pour que la transition soit visible
            setTimeout(() => {
                newsPage.classList.add('active');
            }, 50);
            if (typeof fetchDiscordNews === 'function') {
                fetchDiscordNews();
            }
        }
    } else if (page === 'updates') {
        console.log('Affichage de la page Mises à jour');
        const updatesPage = document.querySelector('.page-updates');
        if (updatesPage) {
            updatesPage.style.display = 'block';
            // Petit délai pour que la transition soit visible
            setTimeout(() => {
                updatesPage.classList.add('active');
            }, 50);
            if (typeof fetchUpdates === 'function') {
                fetchUpdates();
            }
        }
    } else if (page === 'settings') {
        console.log('Affichage de la page Paramètres');
        const settingsPage = document.querySelector('.page-settings');
        if (settingsPage) {
            settingsPage.style.display = 'block';
            // Petit délai pour que la transition soit visible
            setTimeout(() => {
                settingsPage.classList.add('active');
            }, 50);
        }
    }
}

// Fonction utilitaire pour obtenir des chemins absolus vers les ressources
async function getAssetPath(assetType, fileName) {
    console.log(`Getting path for ${assetType}/${fileName}`);
    
    try {
        // Essayer d'abord avec IPC
        const result = await ipcRenderer.invoke('get-asset-path', assetType, fileName);
        if (result.success) {
            console.log('Got asset path from main process:', result.url);
            return result.url;
        } else {
            console.warn('Failed to get asset path from main process:', result.error);
        }
    } catch (err) {
        console.warn('Error invoking get-asset-path:', err);
    }
    
    // Fallback methods
    let assetPath = `./${assetType}/${fileName}`;
    
    try {
        // Différentes stratégies de fallback
        try {
            // Tenter d'utiliser le module path
            const path = require('path');
            const appPath = process.cwd();
            
            // Construire le chemin absolu
            if (assetType === 'backgrounds') {
                assetPath = path.join(appPath, 'assets', 'backgrounds', fileName);
            } else {
                assetPath = path.join(appPath, 'assets', fileName);
            }
            
            console.log('Asset absolute path:', assetPath);
            return `file://${assetPath}`;
        } catch (err) {
            console.warn('Failed to get path with path module:', err);
            
            // Fallback: essayer d'utiliser l'URL de base
            const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
            if (assetType === 'backgrounds') {
                assetPath = `${baseUrl}/assets/backgrounds/${fileName}`;
            } else {
                assetPath = `${baseUrl}/assets/${fileName}`;
            }
            console.log('Asset URL with baseUrl:', assetPath);
            return assetPath;
        }
    } catch (err) {
        console.error('All path resolution strategies failed:', err);
        // Dernier recours: chemin relatif simple
        if (assetType === 'backgrounds') {
            return `./assets/backgrounds/${fileName}`;
        } else {
            return `./assets/${fileName}`;
        }
    }
}

// Gestionnaires pour les boutons de fermeture des onglets (supprimés)
const pageSettings = document.querySelector('.page-settings');
const pageNews = document.querySelector('.page-news');
const pageUpdates = document.querySelector('.page-updates');

// Fonction pour fermer les onglets avec animation
function closeAllTabs() {
    if (pageSettings) {
        pageSettings.classList.remove('active');
        setTimeout(() => {
            pageSettings.style.display = 'none';
        }, 300);
    }
    if (pageNews) {
        pageNews.classList.remove('active');
        setTimeout(() => {
            pageNews.style.display = 'none';
        }, 300);
    }
    if (pageUpdates) {
        pageUpdates.classList.remove('active');
        setTimeout(() => {
            pageUpdates.style.display = 'none';
        }, 300);
    }
}

// Gestionnaires pour les liens de navigation
document.querySelectorAll('.nav a').forEach(navLink => {
    navLink.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Retirer la classe active de tous les liens
        document.querySelectorAll('.nav a').forEach(link => {
            link.classList.remove('active');
        });
        
        // Ajouter la classe active au lien cliqué
        navLink.classList.add('active');
        
        // Fermer tous les onglets
        closeAllTabs();
        
        // Ouvrir l'onglet correspondant
        const page = navLink.getAttribute('data-page');
        if (page === 'home') {
            // Ne rien faire, on est déjà sur la page d'accueil
        } else if (page === 'news') {
            pageNews.style.display = 'block';
            // Déclencher un reflow avant d'ajouter la classe
            void pageNews.offsetWidth;
            pageNews.classList.add('active');
        } else if (page === 'updates') {
            pageUpdates.style.display = 'block';
            void pageUpdates.offsetWidth;
            pageUpdates.classList.add('active');
        } else if (page === 'settings') {
            pageSettings.style.display = 'block';
            void pageSettings.offsetWidth;
            pageSettings.classList.add('active');
        }
    });
});

// Fonction pour mettre à jour le nombre de joueurs en ligne
async function updateServerStatus() {
    const onlinePlayersElement = document.getElementById('online-players');
    if (!onlinePlayersElement) return;

    try {
        // Appeler la fonction du processus principal
        const result = await ipcRenderer.invoke('query-server', currentServerConfig);
        
        if (result.error) {
            console.error('Erreur serveur:', result.error);
            onlinePlayersElement.textContent = '--';
            return;
        }
        
        // Ajouter une classe pour l'animation
        onlinePlayersElement.classList.add('updating');
        
        // Mettre à jour l'élément avec le nombre de joueurs en ligne
        onlinePlayersElement.textContent = `${result.online}/${result.max}`;
        
        // Retirer la classe d'animation après un délai
        setTimeout(() => {
            onlinePlayersElement.classList.remove('updating');
        }, 500);
        
        // Mettre à jour d'autres informations si nécessaire
        console.log('Info serveur:', result);
    } catch (error) {
        console.error('Erreur lors de la récupération des infos serveur:', error);
        onlinePlayersElement.textContent = '--';
    }
}

// Démarrer les requêtes de statut serveur à intervalles réguliers
function startServerStatusUpdates() {
    // D'abord, effectuer une mise à jour immédiate
    updateServerStatus();
    
    // Ensuite, configurer un intervalle pour les mises à jour régulières (toutes les 60 secondes)
    if (serverQueryInterval) {
        clearInterval(serverQueryInterval);
    }
    
    serverQueryInterval = setInterval(updateServerStatus, 60000); // 60 secondes
}

// Arrêter les requêtes de statut serveur
function stopServerStatusUpdates() {
    if (serverQueryInterval) {
        clearInterval(serverQueryInterval);
        serverQueryInterval = null;
    }
}

// Gestionnaire pour le bouton Temps de jeu
document.getElementById('playtime-btn').addEventListener('click', async function() {
    try {
        const stats = await ipcRenderer.invoke('get-game-stats');
        
        // Mettre à jour les valeurs dans le modal
        document.getElementById('total-playtime').textContent = formatDetailedPlayTime(stats.playTime);
        
        // Récupérer d'autres statistiques depuis l'IPC
        document.getElementById('session-count').textContent = stats.sessionCount || 0;
        
        // Dernière session
        document.getElementById('last-session').textContent = stats.lastSessionDate || '--/--/---- --:--';
        
        // Afficher le modal
        document.querySelector('.playtime-modal').style.display = 'block';
    } catch (error) {
        console.error('Erreur lors de la récupération des statistiques de jeu:', error);
    }
});

// Gestionnaire pour fermer le modal
document.querySelector('.playtime-modal .close-modal').addEventListener('click', function() {
    document.querySelector('.playtime-modal').style.display = 'none';
});