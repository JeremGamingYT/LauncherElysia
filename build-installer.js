const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

// Chemins des dossiers
const srcDir = path.join(__dirname, 'src');
const assetsDir = path.join(srcDir, 'assets');
const distDir = path.join(__dirname, 'dist');

// Assurez-vous que le dossier dist existe
fs.ensureDirSync(distDir);

// Fonction pour préparer les images pour l'installateur
function prepareInstallerImages() {
  console.log('Préparation des images pour l\'installateur...');
  
  // Créer l'image pour la barre latérale de l'installateur (164x314)
  // Comme nous n'avons pas sharp, nous allons simplement copier une image existante si disponible
  try {
    if (fs.existsSync(path.join(assetsDir, 'installer-sidebar.bmp'))) {
      console.log('Image de barre latérale déjà présente.');
    } else {
      console.log('ATTENTION: Vous devez créer manuellement une image installer-sidebar.bmp (164x314 pixels) dans le dossier src/assets');
    }
  } catch (err) {
    console.error('Erreur lors de la vérification des images:', err);
  }
}

// Fonction pour préparer les fichiers de l'interface personnalisée
function prepareCustomInstallerUI() {
  console.log('Préparation des fichiers pour l\'interface personnalisée de l\'installateur...');
  
  // S'assurer que les dossiers nécessaires existent
  fs.ensureDirSync(path.join(distDir, 'installer-files'));
  
  // Copier les fichiers nécessaires dans le répertoire de construction
  fs.copyFileSync('installer-page.html', path.join(distDir, 'installer-files', 'installer-page.html'));
  fs.copyFileSync('installer.css', path.join(distDir, 'installer-files', 'installer.css'));
  
  // Copier l'icône pour l'installateur personnalisé
  fs.copyFileSync(path.join(assetsDir, 'icon.ico'), path.join(distDir, 'installer-files', 'icon.ico'));
  
  console.log('Fichiers d\'interface personnalisée prêts.');
}

// Fonction principale pour construire l'installateur
async function buildInstaller() {
  try {
    console.log('Construction de l\'installateur Elysia...');
    
    // Préparer les images pour l'installateur
    prepareInstallerImages();
    
    // Préparer les fichiers d'interface personnalisée
    prepareCustomInstallerUI();
    
    // Utiliser electron-builder directement avec l'option nsis
    console.log('Construction de l\'installateur avec electron-builder...');
    execSync('npx electron-builder --win nsis', { stdio: 'inherit' });
    
    console.log('Installateur créé avec succès!');
    
  } catch (err) {
    console.error('Erreur lors de la construction de l\'installateur:', err);
    process.exit(1);
  }
}

// Exécuter la construction
buildInstaller(); 