import { Socket } from 'net';
import https from 'https';
import http from 'http';
import { debug, errorWithTimestamp } from './debug.js';

/**
 * TunnelHealthChecker - Vérifie périodiquement l'état du tunnel
 * 
 * Fonctionnalités:
 * 1. Vérifie si le port local est toujours accessible
 * 2. Pour les tunnels HTTP, vérifie si le tunnel fonctionne via une requête HTTP
 * 3. Pour les tunnels TCP, vérifie si le tunnel fonctionne via une connexion TCP
 * 4. Vérifie si le serveur relais est disponible
 * 5. Déclenche la reconnexion automatique dès que possible
 * 6. Continue de surveiller même quand le tunnel/relais est down et reconnecte dès récupération
 */
export class TunnelHealthChecker {
  /**
   * @param {Object} options - Options de configuration
   * @param {string} options.localHost - Hôte local (ex: 'localhost')
   * @param {number} options.localPort - Port local à vérifier
   * @param {string} options.tunnelType - Type de tunnel ('http' ou 'tcp')
   * @param {string} options.publicUrl - URL/adresse publique du tunnel (pour vérification HTTP ou TCP)
   * @param {number} options.publicPort - Port public du tunnel TCP
   * @param {string} options.relayServer - Serveur relais (ex: 'tcp.relais.dev:1080')
   * @param {number} options.checkInterval - Intervalle de vérification en ms (défaut: 30000)
   * @param {number} options.localPortTimeout - Timeout pour vérification port local en ms (défaut: 5000)
   * @param {number} options.tunnelTimeout - Timeout pour vérification tunnel en ms (défaut: 10000)
   */
  constructor(options = {}) {
    this.localHost = options.localHost || 'localhost';
    this.localPort = options.localPort;
    this.tunnelType = options.tunnelType || 'http';
    this.publicUrl = options.publicUrl || null;
    this.publicPort = options.publicPort || null;
    this.relayServer = options.relayServer || 'tcp.relais.dev';
    this.checkInterval = options.checkInterval || 30000; // 30 secondes par défaut
    this.localPortTimeout = options.localPortTimeout || 5000; // 5 secondes
    this.tunnelTimeout = options.tunnelTimeout || 10000; // 10 secondes

    this.isRunning = false;
    this.intervalId = null;
    this.lastLocalPortCheck = { success: true, timestamp: Date.now() };
    this.lastTunnelCheck = { success: true, timestamp: Date.now() };
    this.consecutiveLocalFailures = 0;
    this.consecutiveTunnelFailures = 0;
    this.maxConsecutiveFailures = 3; // Nombre d'échecs consécutifs avant action

    // États de suivi pour la récupération automatique
    this.tunnelIsDown = false;           // Le tunnel est détecté comme non fonctionnel
    this.waitingForRecovery = false;     // En attente de récupération (relais ou tunnel)
    this.reconnectTriggered = false;     // Une reconnexion a déjà été déclenchée

    // Callbacks
    this.onLocalPortDown = null;
    this.onLocalPortRestored = null;
    this.onTunnelDown = null;
    this.onTunnelRestored = null;
    this.onReconnectNeeded = null;
  }

  /**
   * Démarre la vérification périodique de santé du tunnel
   * @param {Object} callbacks - Callbacks pour les événements
   * @param {Function} callbacks.onLocalPortDown - Appelé quand le port local est inaccessible
   * @param {Function} callbacks.onLocalPortRestored - Appelé quand le port local est rétabli
   * @param {Function} callbacks.onTunnelDown - Appelé quand le tunnel ne fonctionne pas
   * @param {Function} callbacks.onTunnelRestored - Appelé quand le tunnel est rétabli
   * @param {Function} callbacks.onReconnectNeeded - Appelé quand une reconnexion est nécessaire
   */
  start(callbacks = {}) {
    if (this.isRunning) {
      debug('TunnelHealthChecker déjà en cours d\'exécution');
      return;
    }

    this.onLocalPortDown = callbacks.onLocalPortDown || null;
    this.onLocalPortRestored = callbacks.onLocalPortRestored || null;
    this.onTunnelDown = callbacks.onTunnelDown || null;
    this.onTunnelRestored = callbacks.onTunnelRestored || null;
    this.onReconnectNeeded = callbacks.onReconnectNeeded || null;

    this.isRunning = true;
    this.consecutiveLocalFailures = 0;
    this.consecutiveTunnelFailures = 0;
    this.tunnelIsDown = false;
    this.waitingForRecovery = false;
    this.reconnectTriggered = false;

    debug(`TunnelHealthChecker démarré - Vérification toutes les ${this.checkInterval / 1000}s`);
    debug(`  - Port local: ${this.localHost}:${this.localPort}`);
    debug(`  - Type de tunnel: ${this.tunnelType}`);
    if (this.tunnelType === 'http' && this.publicUrl) {
      debug(`  - URL publique: ${this.publicUrl}`);
    } else if (this.tunnelType === 'tcp' && this.publicUrl && this.publicPort) {
      debug(`  - Adresse TCP publique: ${this.publicUrl}:${this.publicPort}`);
    }

    // Première vérification après un court délai (laisser le tunnel s'établir)
    setTimeout(() => {
      if (this.isRunning) {
        this.performHealthCheck();
      }
    }, 5000);

    // Planifier les vérifications périodiques
    this.intervalId = setInterval(() => {
      if (this.isRunning) {
        this.performHealthCheck();
      }
    }, this.checkInterval);
  }

  /**
   * Arrête la vérification de santé
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    debug('TunnelHealthChecker arrêté');
  }

  /**
   * Effectue une vérification complète de santé
   */
  async performHealthCheck() {
    // Si une reconnexion a déjà été déclenchée, ne pas faire d'autres vérifications
    if (this.reconnectTriggered) {
      debug('Reconnexion déjà déclenchée, en attente...');
      return;
    }

    debug('Vérification de santé du tunnel en cours...');

    // 1. Vérifier le port local
    const localPortOk = await this.checkLocalPort();
    this.handleLocalPortResult(localPortOk);

    // Si le port local n'est pas OK, pas besoin de vérifier le tunnel
    if (!localPortOk) {
      return;
    }

    // 2. Si on est en mode "attente de récupération", vérifier si on peut reconnecter
    if (this.waitingForRecovery) {
      await this.checkForRecovery();
      return;
    }

    // 3. Vérifier le tunnel selon son type
    if (this.tunnelType === 'http' && this.publicUrl) {
      const tunnelOk = await this.checkTunnelHttp();
      await this.handleTunnelResult(tunnelOk);
    } else if (this.tunnelType === 'tcp' && this.publicUrl && this.publicPort) {
      const tunnelOk = await this.checkTunnelTcp();
      await this.handleTunnelResult(tunnelOk);
    }
  }

  /**
   * Vérifie si le système peut récupérer (appelé quand on est en attente de récupération)
   */
  async checkForRecovery() {
    const tunnelTypeLabel = this.tunnelType === 'http' ? 'HTTP' : 'TCP';
    
    // D'abord vérifier si le serveur relais est accessible
    const relayOk = await this.checkRelayServer();
    
    if (!relayOk) {
      debug('Serveur relais toujours inaccessible, attente...');
      return;
    }

    debug('Serveur relais accessible, vérification du tunnel...');

    // Le relais est OK, maintenant vérifier si le tunnel fonctionne
    let tunnelOk = false;
    if (this.tunnelType === 'http' && this.publicUrl) {
      tunnelOk = await this.checkTunnelHttp();
    } else if (this.tunnelType === 'tcp' && this.publicUrl && this.publicPort) {
      tunnelOk = await this.checkTunnelTcp();
    }

    if (tunnelOk) {
      // Le tunnel fonctionne à nouveau !
      console.log(`✅ Tunnel ${tunnelTypeLabel} rétabli automatiquement`);
      this.tunnelIsDown = false;
      this.waitingForRecovery = false;
      this.consecutiveTunnelFailures = 0;
      this.lastTunnelCheck = { success: true, timestamp: Date.now() };
      
      if (this.onTunnelRestored) {
        this.onTunnelRestored();
      }
    } else {
      // Le relais est OK mais le tunnel ne fonctionne pas -> reconnexion nécessaire
      errorWithTimestamp(`🔄 Serveur relais accessible mais tunnel ${tunnelTypeLabel} non fonctionnel - Reconnexion...`);
      this.triggerReconnect();
    }
  }

  /**
   * Déclenche une reconnexion
   */
  triggerReconnect() {
    if (this.reconnectTriggered) {
      debug('Reconnexion déjà en cours, ignoré');
      return;
    }

    this.reconnectTriggered = true;
    
    if (this.onReconnectNeeded) {
      this.onReconnectNeeded();
    }
  }

  /**
   * Vérifie si le port local est accessible via une connexion TCP
   * @returns {Promise<boolean>} - true si le port est accessible
   */
  checkLocalPort() {
    return new Promise((resolve) => {
      const socket = new Socket();
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
        }
      };

      const timeout = setTimeout(() => {
        debug(`Timeout lors de la vérification du port local ${this.localHost}:${this.localPort}`);
        cleanup();
        resolve(false);
      }, this.localPortTimeout);

      socket.connect(
        {
          host: this.localHost,
          port: this.localPort,
        },
        () => {
          clearTimeout(timeout);
          debug(`Port local ${this.localHost}:${this.localPort} accessible`);
          cleanup();
          resolve(true);
        }
      );

      socket.on('error', (err) => {
        clearTimeout(timeout);
        debug(`Erreur connexion port local: ${err.message}`);
        cleanup();
        resolve(false);
      });
    });
  }

  /**
   * Vérifie si le tunnel HTTP fonctionne en effectuant une requête vers l'URL publique
   * @returns {Promise<boolean>} - true si le tunnel répond
   */
  checkTunnelHttp() {
    return new Promise((resolve) => {
      if (!this.publicUrl) {
        resolve(true); // Pas d'URL publique, on considère que c'est OK
        return;
      }

      const url = this.publicUrl.startsWith('http') ? this.publicUrl : `https://${this.publicUrl}`;
      const isHttps = url.startsWith('https');
      const httpModule = isHttps ? https : http;

      const timeout = setTimeout(() => {
        debug(`Timeout lors de la vérification du tunnel HTTP: ${url}`);
        resolve(false);
      }, this.tunnelTimeout);

      const request = httpModule.get(url, {
        timeout: this.tunnelTimeout,
        headers: {
          'User-Agent': 'Relais-Tunnel-HealthCheck/1.0',
          // Header spécial pour identifier les health checks
          'X-Relais-Health-Check': 'true'
        },
        // Ne pas suivre les redirects automatiquement
        maxRedirects: 0,
      }, (response) => {
        clearTimeout(timeout);
        
        // Consommer les données pour éviter les fuites mémoire
        response.on('data', () => {});
        response.on('end', () => {});

        // Tout code de réponse indique que le tunnel fonctionne
        // (même 4xx ou 5xx signifie que la requête est passée par le tunnel)
        const success = response.statusCode !== undefined;
        debug(`Vérification tunnel HTTP: ${url} - Status: ${response.statusCode} - ${success ? 'OK' : 'ÉCHEC'}`);
        resolve(success);
      });

      request.on('error', (err) => {
        clearTimeout(timeout);
        debug(`Erreur vérification tunnel HTTP: ${err.message}`);
        resolve(false);
      });

      request.on('timeout', () => {
        clearTimeout(timeout);
        debug('Timeout requête tunnel HTTP');
        request.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Vérifie si le tunnel TCP fonctionne en tentant une connexion vers l'adresse publique
   * @returns {Promise<boolean>} - true si le tunnel répond
   */
  checkTunnelTcp() {
    return new Promise((resolve) => {
      if (!this.publicUrl || !this.publicPort) {
        resolve(true); // Pas d'adresse publique, on considère que c'est OK
        return;
      }

      const socket = new Socket();
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
        }
      };

      const timeout = setTimeout(() => {
        debug(`Timeout lors de la vérification du tunnel TCP: ${this.publicUrl}:${this.publicPort}`);
        cleanup();
        resolve(false);
      }, this.tunnelTimeout);

      socket.connect(
        {
          host: this.publicUrl,
          port: parseInt(this.publicPort),
        },
        () => {
          clearTimeout(timeout);
          debug(`Tunnel TCP ${this.publicUrl}:${this.publicPort} accessible`);
          cleanup();
          resolve(true);
        }
      );

      socket.on('error', (err) => {
        clearTimeout(timeout);
        debug(`Erreur vérification tunnel TCP: ${err.message}`);
        cleanup();
        resolve(false);
      });
    });
  }

  /**
   * Vérifie si le serveur relais est accessible
   * @returns {Promise<boolean>} - true si le serveur relais répond
   */
  checkRelayServer() {
    return new Promise((resolve) => {
      const socket = new Socket();
      let resolved = false;

      const [host, port] = this.relayServer.includes(':') 
        ? this.relayServer.split(':') 
        : [this.relayServer, '1080'];

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
        }
      };

      const timeout = setTimeout(() => {
        debug(`Timeout lors de la vérification du serveur relais ${host}:${port}`);
        cleanup();
        resolve(false);
      }, this.localPortTimeout);

      socket.connect(
        {
          host: host,
          port: parseInt(port),
        },
        () => {
          clearTimeout(timeout);
          debug(`Serveur relais ${host}:${port} accessible`);
          cleanup();
          resolve(true);
        }
      );

      socket.on('error', (err) => {
        clearTimeout(timeout);
        debug(`Erreur connexion serveur relais: ${err.message}`);
        cleanup();
        resolve(false);
      });
    });
  }

  /**
   * Gère le résultat de la vérification du port local
   * @param {boolean} success - true si le port est accessible
   */
  handleLocalPortResult(success) {
    const wasDown = this.consecutiveLocalFailures >= this.maxConsecutiveFailures;

    if (success) {
      if (wasDown && this.onLocalPortRestored) {
        console.log(`✅ Le service local sur le port ${this.localPort} est de nouveau accessible`);
        this.onLocalPortRestored();
      }
      this.consecutiveLocalFailures = 0;
      this.lastLocalPortCheck = { success: true, timestamp: Date.now() };
    } else {
      this.consecutiveLocalFailures++;
      this.lastLocalPortCheck = { success: false, timestamp: Date.now() };

      if (this.consecutiveLocalFailures >= this.maxConsecutiveFailures) {
        if (!wasDown) {
          errorWithTimestamp(`⚠️  Port local ${this.localHost}:${this.localPort} inaccessible (${this.consecutiveLocalFailures} échecs consécutifs)`);
          if (this.onLocalPortDown) {
            this.onLocalPortDown();
          }
        }
      } else {
        debug(`Port local inaccessible - tentative ${this.consecutiveLocalFailures}/${this.maxConsecutiveFailures}`);
      }
    }
  }

  /**
   * Gère le résultat de la vérification du tunnel (HTTP ou TCP)
   * @param {boolean} success - true si le tunnel fonctionne
   */
  async handleTunnelResult(success) {
    const tunnelTypeLabel = this.tunnelType === 'http' ? 'HTTP' : 'TCP';

    if (success) {
      // Tunnel fonctionne
      if (this.tunnelIsDown && this.onTunnelRestored) {
        console.log(`✅ Tunnel ${tunnelTypeLabel} rétabli`);
        this.onTunnelRestored();
      }
      this.tunnelIsDown = false;
      this.waitingForRecovery = false;
      this.consecutiveTunnelFailures = 0;
      this.lastTunnelCheck = { success: true, timestamp: Date.now() };
    } else {
      // Tunnel ne fonctionne pas
      this.consecutiveTunnelFailures++;
      this.lastTunnelCheck = { success: false, timestamp: Date.now() };

      if (this.consecutiveTunnelFailures >= this.maxConsecutiveFailures) {
        if (!this.tunnelIsDown) {
          // Première détection de panne
          this.tunnelIsDown = true;
          errorWithTimestamp(`⚠️  Tunnel ${tunnelTypeLabel} non fonctionnel (${this.consecutiveTunnelFailures} échecs consécutifs)`);
          
          if (this.onTunnelDown) {
            this.onTunnelDown();
          }

          // Vérifier immédiatement si le serveur relais est accessible
          const relayOk = await this.checkRelayServer();
          
          if (relayOk) {
            // Le serveur relais est OK -> reconnexion immédiate
            errorWithTimestamp('🔄 Serveur relais accessible - Reconnexion du tunnel...');
            this.triggerReconnect();
          } else {
            // Le serveur relais n'est pas accessible -> passer en mode attente
            errorWithTimestamp('🚨 Serveur relais inaccessible - Surveillance en cours, reconnexion automatique dès récupération...');
            this.waitingForRecovery = true;
          }
        }
      } else {
        debug(`Tunnel ${tunnelTypeLabel} non fonctionnel - tentative ${this.consecutiveTunnelFailures}/${this.maxConsecutiveFailures}`);
      }
    }
  }

  /**
   * Retourne l'état actuel de la vérification de santé
   * @returns {Object} - État de santé du tunnel
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      localPort: {
        host: this.localHost,
        port: this.localPort,
        lastCheck: this.lastLocalPortCheck,
        consecutiveFailures: this.consecutiveLocalFailures,
        isDown: this.consecutiveLocalFailures >= this.maxConsecutiveFailures,
      },
      tunnel: {
        type: this.tunnelType,
        publicUrl: this.publicUrl,
        publicPort: this.publicPort,
        lastCheck: this.lastTunnelCheck,
        consecutiveFailures: this.consecutiveTunnelFailures,
        isDown: this.tunnelIsDown,
        waitingForRecovery: this.waitingForRecovery,
      },
      checkInterval: this.checkInterval,
    };
  }

  /**
   * Effectue une vérification de santé à la demande
   * @returns {Promise<Object>} - Résultat de la vérification
   */
  async checkNow() {
    const localPortOk = await this.checkLocalPort();
    let tunnelOk = true;

    if (this.tunnelType === 'http' && this.publicUrl) {
      tunnelOk = await this.checkTunnelHttp();
    } else if (this.tunnelType === 'tcp' && this.publicUrl && this.publicPort) {
      tunnelOk = await this.checkTunnelTcp();
    }

    const relayOk = await this.checkRelayServer();

    return {
      localPort: localPortOk,
      tunnel: tunnelOk,
      relayServer: relayOk,
      timestamp: Date.now(),
    };
  }
}
