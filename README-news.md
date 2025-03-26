# Gestion des Actualités du Launcher Elysia

Ce document explique comment gérer les actualités affichées dans le launcher Elysia.

## À propos du système d'actualités

Le launcher Elysia affiche des actualités directement depuis un fichier JSON hébergé sur GitHub. Cette solution est :
- Simple à maintenir
- Ne nécessite aucun serveur supplémentaire
- Facile à mettre à jour via GitHub

## Comment mettre à jour les actualités

1. Modifiez le fichier `news.json` dans le répertoire principal du projet GitHub
2. Respectez la structure du fichier (voir ci-dessous)
3. Créez un commit avec vos modifications
4. Le launcher récupérera automatiquement les dernières actualités

## Structure du fichier news.json

```json
{
  "messages": [
    {
      "id": "1",                     // Identifiant unique (texte ou nombre)
      "title": "Titre de l'actualité",
      "content": "Contenu détaillé de l'actualité...",
      "author": "Nom de l'auteur",
      "timestamp": "2023-08-15T12:30:45Z",  // Format date ISO
      "image": "",     // Champ d'image (préférablement vide pour des performances optimales)
      "url": "https://lien-vers-plus-d-infos"  // URL pour en savoir plus
    },
    // Ajoutez d'autres actualités ici
  ]
}
```

## Conseils pour les actualités

- Placez toujours les actualités les plus récentes en haut du tableau
- Utilisez des ID uniques pour chaque actualité
- Limitez le nombre d'actualités à 10 maximum pour des performances optimales
- Laissez le champ "image" vide pour des performances optimales (depuis v1.7.1)
- Vérifiez que votre JSON est valide avant de le publier

## Exemple pratique

Pour ajouter une nouvelle actualité :

1. Ajoutez un nouvel objet au début du tableau `messages`
2. Donnez-lui un ID unique (par exemple, incrémentez le dernier ID)
3. Remplissez tous les champs requis
4. Validez votre JSON (vous pouvez utiliser un validateur en ligne)
5. Faites un commit et push sur GitHub

Le launcher affichera automatiquement votre nouvelle actualité lors du prochain démarrage ou rafraîchissement de l'onglet Actualités. 