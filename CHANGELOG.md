# Changelog

## [1.1.0] - 2025-01-26

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