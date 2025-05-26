#!/bin/bash

# Script d'installation pour le client Node.js Relais
# Version 1.1.0 avec améliorations de stabilité

echo "📦 Installation du client Node.js Relais v1.1.0"
echo "🔧 Avec améliorations de stabilité de connexion"
echo ""

# Vérifier que Node.js est installé
if ! command -v node &> /dev/null; then
    echo "❌ Node.js n'est pas installé. Veuillez installer Node.js 18+ d'abord."
    exit 1
fi

# Vérifier la version de Node.js
NODE_VERSION=$(node -v | sed 's/v//')
REQUIRED_VERSION="18.0.0"

if ! node -e "process.exit(process.versions.node.split('.').reduce((a,b,i)=>a+b*Math.pow(10,3-i),0) >= '$REQUIRED_VERSION'.split('.').reduce((a,b,i)=>a+b*Math.pow(10,3-i),0))"; then
    echo "❌ Node.js version $NODE_VERSION détectée. Version 18+ requise."
    exit 1
fi

echo "✅ Node.js version $NODE_VERSION détectée"

# Installer les dépendances
echo "📥 Installation des dépendances..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Dépendances installées avec succès"
else
    echo "❌ Erreur lors de l'installation des dépendances"
    exit 1
fi

# Lien global (optionnel)
read -p "🔗 Voulez-vous installer le client globalement ? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🔗 Installation globale..."
    npm link
    if [ $? -eq 0 ]; then
        echo "✅ Client installé globalement. Utilisez 'relais' dans n'importe quel répertoire."
    else
        echo "⚠️  Erreur lors de l'installation globale. Vous pouvez utiliser 'npm start' dans ce répertoire."
    fi
else
    echo "ℹ️  Installation locale. Utilisez 'npm start' ou 'node src/index.js' pour lancer le client."
fi

echo ""
echo "🎉 Installation terminée !"
echo ""
echo "📖 Utilisation :"
echo "  1. Sauvegarder un token : relais set-token YOUR_TOKEN"
echo "  2. Créer un tunnel     : relais tunnel -p 3000"
echo "  3. Avec options        : relais tunnel -p 8080 -d mon-domaine.com -v"
echo ""
echo "🆕 Nouveautés v1.1.0 :"
echo "  ✨ Gestion des heartbeats pour une connexion stable"
echo "  ⏱️  Timeouts optimisés (60s keep-alive, 120s données)"
echo "  🔄 Reconnexion automatique améliorée"
echo "  🐛 Plus de déconnexions toutes les 30-45 secondes" 