# Changelog

## [1.1.2] - 2025-01-26

### Amélioration de la gestion des connexions et diagnostics 🔧

#### Ajouté
- **Limitation des reconnexions** : Le client s'arrête automatiquement après 4 fermetures de connexion par le serveur en 1 minute
- **Backoff exponentiel intelligent** : Délai progressif (100ms → 500ms → 1s → 2s+) entre les tentatives de reconnexion
- **Commande `check-token`** : Vérification du token sauvegardé avec aperçu sécurisé
- **Commande `debug-config`** : Diagnostic complet des permissions et configuration sur Linux
- **Meilleure gestion des erreurs token** : Messages d'erreur plus précis pour les problèmes de permissions

#### Amélioré
- **Gestion des permissions Linux** : Vérification automatique des permissions de lecture/écriture
- **Sécurité des tokens** : Permissions de fichier restreintes (600) pour les tokens
- **Messages d'erreur** : Distinction claire entre "pas de token" et "erreurs de permissions"
- **Vérification post-sauvegarde** : Validation automatique que le token a été correctement sauvegardé

#### Corrigé
- **Boucles de reconnexion infinies** : Arrêt intelligent après trop d'échecs
- **Problèmes de tokens sur Linux** : Meilleure détection et correction des problèmes de permissions
- **Tokens vides ou corrompus** : Validation et messages d'erreur appropriés

#### Technique
- Nouvelle classe `ConnectionFailureTracker` pour surveiller les échecs
- Amélioration du module `config.js` avec vérifications de permissions
- Logging de débogage pour faciliter le troubleshooting

---

## [1.1.1] - 2025-01-26

### Améliorations de la stabilité de connexion 🚀

#### Ajouté
- **Gestion des heartbeats** : Le client reçoit et traite maintenant correctement les messages de heartbeat du serveur
- **Monitoring de connexion** : Détection automatique des connexions mortes en surveillant les heartbeats
- **Timeouts optimisés** : Tous les timeouts sont maintenant synchronisés avec le serveur

#### Modifié
- **TCP Keep-Alive** : Augmenté de 30s à 60s pour correspondre au serveur
- **Timeouts de connexion** : Augmentés de 60s à 120s pour les connexions de données
- **Timeout de contrôle** : Augmenté à 180s (3 minutes) pour la connexion de contrôle
- **Gestion d'erreur** : Meilleure propagation d'erreurs pour déclencher la reconnexion

#### Corrigé
- **Déconnexions fréquentes** : Résolution du problème de déconnexion toutes les 30-45 secondes
- **Timeout prématuré** : Les connexions ne se ferment plus prématurément
- **Détection de panne** : Meilleure détection des connexions fermées côté serveur

#### Technique
- Ajout de la classe `HeartbeatMsg` pour les messages de heartbeat
- Fonction `startHeartbeatMonitoring()` pour surveiller la santé de la connexion
- Synchronisation des paramètres réseau avec les améliorations serveur

---

## [1.0.2] - Version précédente
- Fonctionnalités de base du tunnel
- Support des protocols HTTP et TCP
- Gestion des tokens d'authentification 