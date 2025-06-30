import https from 'https';
import { debug, errorWithTimestamp } from './debug.js';

/**
 * Health monitor qui vérifie périodiquement l'accessibilité du serveur
 * Si le serveur n'est pas accessible pendant 30 secondes consécutives,
 * il déclenche une interruption de connexion et attend la rétablissement
 */
export class HealthMonitor {
  constructor(healthUrl = 'https://relais.dev/api/health') {
    this.healthUrl = healthUrl;
    this.checkInterval = 3000; // Check every 3 seconds for faster detection
    this.checkIntervalWhenDown = 1000; // Check every second when down
    this.failureThreshold = 15000; // 15 seconds of consecutive failures
    this.isRunning = false;
    this.lastSuccessTime = Date.now();
    this.consecutiveFailures = 0;
    this.onConnectionLost = null;
    this.onConnectionRestored = null;
    this.intervalId = null;
    this.currentlyDown = false;
  }

  /**
   * Démarre le monitoring de santé
   * @param {Function} onConnectionLost - Callback appelé quand la connexion est perdue
   * @param {Function} onConnectionRestored - Callback appelé quand la connexion est rétablie
   */
  start(onConnectionLost = null, onConnectionRestored = null) {
    if (this.isRunning) {
      debug('Health monitor is already running');
      return;
    }

    this.onConnectionLost = onConnectionLost;
    this.onConnectionRestored = onConnectionRestored;
    this.isRunning = true;
    this.lastSuccessTime = Date.now();
    this.consecutiveFailures = 0;
    this.currentlyDown = false;

    debug('Starting health monitor...', this.healthUrl);
    
    // Start with normal interval
    this.scheduleNextCheck(this.checkInterval);

    // Effectuer une vérification immédiate
    this.performHealthCheck();
  }

  /**
   * Arrête le monitoring de santé
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
    debug('Health monitor stopped');
  }

  /**
   * Effectue une vérification de santé HTTP
   */
  async performHealthCheck() {
    try {
      const isHealthy = await this.checkServerHealth();
      
      if (isHealthy) {
        this.handleHealthyResponse();
      } else {
        this.handleUnhealthyResponse();
      }
    } catch (error) {
      this.handleUnhealthyResponse(error);
    }
  }

  /**
   * Effectue la requête HTTP vers le endpoint de santé
   * @returns {Promise<boolean>} - true si le serveur répond correctement
   */
  checkServerHealth() {
    return new Promise((resolve) => {
      const timeout = 10000; // 10 secondes de timeout
      
      const request = https.get(this.healthUrl, {
        timeout: timeout,
        headers: {
          'User-Agent': 'Relais-Health-Monitor/1.0'
        }
      }, (response) => {
        let data = '';
        
        response.on('data', (chunk) => {
          data += chunk;
        });
        
        response.on('end', () => {
          try {
            if (response.statusCode === 200) {
              const jsonResponse = JSON.parse(data);
              const isHealthy = jsonResponse.code === 200 && 
                              jsonResponse.message && 
                              jsonResponse.message.includes('healthy');
              
              // debug(`Health check response: ${response.statusCode}, healthy: ${isHealthy}`);
              resolve(isHealthy);
            } else {
              debug(`Health check failed with status: ${response.statusCode}`);
              resolve(false);
            }
          } catch (parseError) {
            debug('Health check - JSON parse error:', parseError.message);
            resolve(false);
          }
        });
      });

      request.on('error', (error) => {
        debug('Health check request error:', error.message);
        resolve(false);
      });

      request.on('timeout', () => {
        debug('Health check request timeout');
        request.destroy();
        resolve(false);
      });

      request.setTimeout(timeout);
    });
  }

  /**
   * Gère une réponse saine du serveur
   */
  handleHealthyResponse() {
    const wasDown = this.currentlyDown;
    this.lastSuccessTime = Date.now();
    this.consecutiveFailures = 0;
    
    if (wasDown) {
      this.currentlyDown = false;
      console.log(`✅ Serveur rétabli! Connexion restaurée à ${new Date().toISOString()}`);
      if (this.onConnectionRestored) {
        this.onConnectionRestored();
      }
    }
    
    // Schedule next check with normal interval
    this.scheduleNextCheck(this.checkInterval);
  }

  /**
   * Gère une réponse défaillante du serveur
   * @param {Error} error - Erreur optionnelle
   */
  handleUnhealthyResponse(error = null) {
    this.consecutiveFailures++;
    const timeSinceLastSuccess = Date.now() - this.lastSuccessTime;
    
    if (error) {
      debug(`Health check failed: ${error.message}`);
    }
    
    // Vérifier si nous avons dépassé le seuil de pannes
    if (timeSinceLastSuccess >= this.failureThreshold && !this.currentlyDown) {
      this.currentlyDown = true;
      errorWithTimestamp(`🚨 Serveur inaccessible depuis ${Math.round(timeSinceLastSuccess/1000)}s - Interruption de la connexion tunnel`);
      
      if (this.onConnectionLost) {
        this.onConnectionLost();
      }
    } else if (this.currentlyDown) {
      // Toujours en panne, afficher un message périodique
      if (this.consecutiveFailures % 10 === 0) { // Every 10 seconds when checking every second
        errorWithTimestamp(`⏳ Serveur toujours inaccessible depuis ${Math.round(timeSinceLastSuccess/1000)}s - En attente de rétablissement...`);
      }
    }
    
    // Schedule next check with faster interval when down
    const nextInterval = this.currentlyDown ? this.checkIntervalWhenDown : this.checkInterval;
    this.scheduleNextCheck(nextInterval);
  }

  /**
   * Attendeur qui bloque jusqu'à ce que le serveur soit de nouveau accessible
   * @returns {Promise<void>}
   */
  async waitForServerRecovery() {
    if (!this.currentlyDown) {
      return; // Le serveur est déjà accessible
    }

    console.log('🔄 Attente du rétablissement du serveur...');
    
    return new Promise((resolve) => {
      const checkRecovery = setInterval(async () => {
        try {
          const isHealthy = await this.checkServerHealth();
          if (isHealthy) {
            clearInterval(checkRecovery);
            this.handleHealthyResponse();
            resolve();
          }
        } catch (error) {
          // Continue d'attendre
        }
      }, this.checkInterval);
    });
  }

  /**
   * Retourne l'état actuel du monitoring
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      currentlyDown: this.currentlyDown,
      timeSinceLastSuccess: Date.now() - this.lastSuccessTime,
      consecutiveFailures: this.consecutiveFailures
    };
  }

  /**
   * Schedule the next health check with adaptive interval
   */
  scheduleNextCheck(interval) {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
    }
    
    if (!this.isRunning) {
      return;
    }
    
    this.intervalId = setTimeout(() => {
      if (this.isRunning) {
        this.performHealthCheck();
      }
    }, interval);
  }
} 