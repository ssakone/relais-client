# Changelog

## [1.6.3] - 2025-12-13

### Fixed
- **Mobile Network Compatibility**: Fixed handshake failures on restrictive mobile networks (tested in Mali)
  - DPI (Deep Packet Inspection) proxies were blocking JSON-formatted handshake messages
  - Handshake now uses binary protocol (base64-encoded) to bypass DPI inspection
  - Connection establishment is now reliable on mobile data networks worldwide

### Changed
- **Binary Handshake Protocol**: SECURE_INIT and SECURE_ACK messages are now encoded in binary format
  - Format: `[0x00 magic byte][4-byte length][base64(JSON)]`
  - Server auto-detects and responds in matching format
  - Full backward compatibility with older JSON-only clients

### Technical
- Added `encodeBinaryHandshake()` and `BinaryHandshakeDecoder` in `secure-channel.js`
- Server-side hybrid protocol detection in `tunnel.go`
- Only handshake is affected; post-handshake AES-GCM encryption remains unchanged

---

## [1.6.2] - 2025-12-10

### Fixed
- **DNS Retry Crash Fix**: Fixed `TypeError: Assignment to constant variable` crash that occurred during DNS resolution retries
  - The `ctrlConn` socket variable was incorrectly declared as `const` preventing reassignment during retry attempts
  - Changed to `let` to allow proper socket recreation on DNS failures

---

## [1.6.1] - 2025-12-10

### Security
- **End-to-End Encryption by Default**: All tunnel communications are now encrypted using ECDH P-256 key exchange + AES-256-GCM
  - Tokens and sensitive data are never transmitted in plaintext
  - Forward secrecy with ephemeral keys per connection
  - Authenticated encryption prevents tampering
- **Vulnerability Fixes**:
  - Fixed `glob` CVE-2025-64756 (command injection)
  - Fixed `tar-fs` GHSA-vj76-c3g6-qr5v (symlink bypass)
  - Removed deprecated `pkg` package (GHSA-22r3-9w55-cj54)

### Added
- `--insecure` flag to disable encryption (not recommended)

### Removed
- Standalone executable builds (`pkg`) - use `npm install -g relais` instead
- `--secure` flag (encryption is now enabled by default)

### Changed
- Reduced dependencies from 204 to 97 packages
- Silent secure handshake (no user-facing messages, debug only)

---

## [1.6.0] - 2025-12-02

### Added
- 🩺 **Automatic Tunnel Health Checking**: New `TunnelHealthChecker` class that continuously monitors tunnel health
  - Verifies local port accessibility via TCP connection test
  - For HTTP tunnels: performs HTTP request to public URL
  - For TCP tunnels: performs TCP connection to public address/port
  - Checks relay server availability before attempting reconnection
- ⏳ **Waiting for Recovery Mode**: When relay server is unreachable, the client monitors continuously and reconnects automatically when the relay comes back online
- ⚙️ **New CLI Options**:
  - `--health-check` - Enable automatic health checking (default: enabled)
  - `--no-health-check` - Disable automatic health checking
  - `--health-check-interval <seconds>` - Configure check interval (default: 30 seconds)

### Removed
- 🗑️ **`--restart-interval` option**: No longer needed - the health checker now handles automatic reconnection when issues are detected

### Changed
- 🔄 **Smart Auto-Reconnection**: Tunnel automatically repairs itself when health check detects failure but relay server is accessible
- 📦 Package description updated to reflect automatic health monitoring

---

## [1.4.3] - 2025-09-05

### Deprecated
- ⚠️ `deploy` command is now deprecated and hidden from CLI help while remaining functional

---

## [1.4.2] - 2025-08-25

### Added
- ✅ New deployment types: `node` and `nextjs`
- ✅ Package.json validation for Node.js and Next.js deployments

### Changed
- ✅ Extended deployment types to include `node` and `nextjs` (in addition to `web`, `react`, and `static`)
- 📦 Increased maximum upload/archive size to 100MB

---

## [1.4.1] - 2025-08-16

### Changed
- ✅ Restricted deployment types to `web`, `react`, and `static`
- 📦 Increased maximum upload/archive size to 100MB

---

## [1.4.0] - 2025-08-16

### Enhancements
- ✨ Terminal animations for key steps using `chalk` (connect, establish tunnel, deploy upload, and status polling)
- 🌐 Simplified server address: always `tcp.relais.dev:1080`

### Removed
- 🗑️ Failover logic to secondary port and old IP references

### Updated
- 📝 README and CLI defaults/messages updated to reflect new server and animations
- 📦 Dependencies: added `chalk@^5.3.0`

---

## [1.2.1] - 2025-06-30

### Nouvelle fonctionnalité - Timeout configurable 🕐

#### Ajouté
- **Paramètre `--timeout` configurable** : Les utilisateurs peuvent maintenant définir leur propre délai d'attente pour l'établissement du tunnel au lieu d'être limités à 30 secondes
- **Timeout dynamique** : Le paramètre accepte une valeur en secondes (ex: `--timeout 60` pour 60 secondes)
- **Valeur par défaut préservée** : Reste 30 secondes si aucune valeur n'est spécifiée
- **Documentation mise à jour** : Exemples d'utilisation ajoutés dans le README

#### Amélioration
- **Flexibilité accrue** : Permet d'adapter le timeout selon les conditions réseau (connexions lentes, serveurs éloignés)
- **Messages d'erreur dynamiques** : Les messages de timeout affichent maintenant la valeur configurée au lieu de "30 seconds"
- **Support dans le CLI** : Disponible dans `src/cli.cjs` (CommonJS)

#### Utilisation
```bash
# Timeout personnalisé de 60 secondes
relais tunnel -p 3000 --timeout 60

# Timeout par défaut (30 secondes)
relais tunnel -p 3000
```

---

## [1.2.0] - 2025-01-26

### Mode Agent Permanent - Reconnexion Persistante 🤖

#### Changements Majeurs
- **Mode Agent Toujours Activé** : Le client ne s'arrête plus jamais pour les erreurs réseau
- **Reconnexion Infinie** : Continue de tenter la connexion indéfiniment en cas d'erreur réseau (EHOSTUNREACH, ETIMEDOUT, etc.)
- **Classification Intelligente des Erreurs** : Distinction entre erreurs réseau (retry infini) et erreurs serveur/auth (arrêt)

#### Amélioré
- **Backoff Exponentiel Optimisé** : 1s → 2s → 4s → 8s → 16s → 30s max (au lieu de 100ms → 500ms → 1s → 2s+)
- **Gestion des Ressources** : Délai maximal de 30s pour éviter une consommation excessive
- **Reset Automatique** : Réinitialisation du tracker d'échecs lors d'une connexion réussie
- **Logging Amélioré** : Meilleure catégorisation des erreurs pour le débogage

#### Technique
- Suppression du système de limitation des reconnexions pour les erreurs réseau
- Séparation des compteurs : `serverClosures` vs `networkErrors`
- Méthode `isNetworkError()` pour identifier les erreurs de connectivité
- Mode agent permanent sans possibilité de désactivation

#### Impact
- **Parfait pour les agents** : Idéal pour les déploiements où le client doit rester connecté en permanence
- **Résilience Réseau** : Survit aux pannes réseau, redémarrages serveur, etc.
- **Maintenance Réduite** : Plus besoin de redémarrer manuellement après des problèmes réseau

---

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