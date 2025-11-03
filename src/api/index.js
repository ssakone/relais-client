/**
 * Relais Client API
 *
 * This module exports the main API for creating and managing tunnels
 * programmatically from Node.js applications (e.g., Electron apps).
 */

import { connectAndServe, runTunnel } from '../tunnel/tunnel-service.js';
import { saveToken, loadToken } from '../utils/config.js';
import { ConnectionFailureTracker } from '../utils/failure-tracker.js';

/**
 * Create a tunnel to expose a local service with event callbacks
 *
 * @param {Object} options - Tunnel options
 * @param {string} options.port - Local service port (required)
 * @param {string} [options.host='localhost'] - Local service host
 * @param {string} [options.server='tcp.relais.dev:1080'] - Relay server address
 * @param {string} [options.type='http'] - Protocol type ('http' or 'tcp')
 * @param {string} [options.domain] - Custom domain
 * @param {string} [options.remote] - Desired remote port
 * @param {string} [options.token] - Authentication token
 * @param {string} [options.timeout='30'] - Tunnel establishment timeout in seconds
 * @param {string} [options.restartInterval='30'] - Tunnel restart interval in minutes
 * @param {boolean} [options.persistent=true] - Enable persistent reconnection on network failures
 * @param {boolean} [options.verbose=false] - Enable detailed logging
 * @param {Function} [options.onConnecting] - Callback when connecting (host, port)
 * @param {Function} [options.onConnected] - Callback when connected (duration)
 * @param {Function} [options.onTunnelReady] - Callback when tunnel is ready (url, publicAddr)
 * @param {Function} [options.onLog] - Callback for log messages (message, level)
 * @param {Function} [options.onError] - Callback for errors (error)
 * @returns {Promise<Object>} Tunnel control object with stop() method
 *
 * @example
 * const tunnel = await createTunnel({
 *   port: '3000',
 *   type: 'http',
 *   persistent: true,
 *   onTunnelReady: (url) => console.log('Tunnel URL:', url),
 *   onLog: (msg) => console.log('Log:', msg),
 * });
 */
export async function createTunnel(options) {
  // Set defaults
  const tunnelOptions = {
    host: 'localhost',
    server: 'tcp.relais.dev:1080',
    type: 'http',
    timeout: '30',
    restartInterval: '30',
    persistent: true,
    verbose: false,
    ...options
  };

  // Validate required parameters
  if (!tunnelOptions.port) {
    throw new Error('Local port is required');
  }

  // Enable debug mode if verbose
  if (tunnelOptions.verbose) {
    process.env.DEBUG = 'true';
  }

  // Try to load token if not provided
  if (!tunnelOptions.token) {
    try {
      tunnelOptions.token = await loadToken();
    } catch (err) {
      // Token is optional, continue without it
    }
  }

  // Intercept console.log pour capturer les logs
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  if (tunnelOptions.onLog) {
    console.log = (...args) => {
      const message = args.join(' ');

      // Détecter le message de tunnel actif
      if (message.includes('🚀 Tunnel active!')) {
        // Match HTTP, HTTPS, and TCP URLs
        const urlMatch = message.match(/(https?|tcp):\/\/[^\s]+/);
        if (urlMatch && tunnelOptions.onTunnelReady) {
          // Generate a unique tunnelId based on options if not provided
          const tunnelId = tunnelOptions.tunnelId || `tunnel-${tunnelOptions.port}-${Date.now()}`;
          tunnelOptions.onTunnelReady(urlMatch[0], tunnelId);
        }
      }

      tunnelOptions.onLog(message, 'info');
      originalConsoleLog(...args);
    };
  }

  if (tunnelOptions.onError) {
    console.error = (...args) => {
      const message = args.join(' ');
      tunnelOptions.onError(new Error(message));
      originalConsoleError(...args);
    };
  }

  let shouldStop = false;
  let controlConnection = null;
  const failureTracker = new ConnectionFailureTracker();

  // Add a callback to capture the control connection once established
  tunnelOptions.onConnectionEstablished = (ctrlConn) => {
    controlConnection = ctrlConn;
  };

  // Lancer le tunnel en arrière-plan
  const tunnelPromise = (async () => {
    try {
      await connectAndServe(tunnelOptions, failureTracker);
    } catch (err) {
      if (tunnelOptions.onError && !shouldStop) {
        tunnelOptions.onError(err);
      }
      throw err;
    } finally {
      // Restaurer console
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
    }
  })();

  // Retourner immédiatement avec un objet de contrôle
  return {
    stop: () => {
      shouldStop = true;
      
      // Force stop the tunnel by destroying the control connection
      if (controlConnection) {
        try {
          console.log('Stopping tunnel by destroying control connection');
          controlConnection.destroy();
        } catch (err) {
          console.error('Error destroying control connection:', err);
        }
      }
      
      // Restaurer console immédiatement
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
    },
    promise: tunnelPromise
  };
}

/**
 * Create a tunnel with auto-reconnection on failures
 * This function will continuously try to reconnect if the connection is lost
 *
 * @param {Object} options - Same as createTunnel options
 * @param {boolean} [options.persistent=true] - Enable persistent reconnection (always true for this function)
 * @returns {Promise<void>} Never resolves (runs indefinitely)
 *
 * @example
 * await createPersistentTunnel({
 *   port: '3000',
 *   type: 'http',
 *   persistent: true
 * });
 */
export async function createPersistentTunnel(options) {
  // Set defaults
  const tunnelOptions = {
    host: 'localhost',
    server: 'tcp.relais.dev:1080',
    type: 'http',
    timeout: '30',
    restartInterval: '30',
    persistent: true,
    verbose: false,
    ...options
  };

  // Validate required parameters
  if (!tunnelOptions.port) {
    throw new Error('Local port is required');
  }

  // Enable debug mode if verbose
  if (tunnelOptions.verbose) {
    process.env.DEBUG = 'true';
  }

  // Try to load token if not provided
  if (!tunnelOptions.token) {
    try {
      tunnelOptions.token = await loadToken();
    } catch (err) {
      // Token is optional, continue without it
    }
  }

  // This will run indefinitely with auto-reconnection
  await runTunnel(tunnelOptions);
}

/**
 * Save an authentication token for future use
 *
 * @param {string} token - Authentication token
 * @returns {Promise<void>}
 *
 * @example
 * await setAuthToken('your-token-here');
 */
export async function setAuthToken(token) {
  if (!token) {
    throw new Error('Token is required');
  }

  try {
    await saveToken(token);
  } catch (err) {
    throw new Error(`Failed to save token: ${err.message}`);
  }
}

/**
 * Get the saved authentication token
 *
 * @returns {Promise<string>} Authentication token
 * @throws {Error} If no token is saved
 *
 * @example
 * const token = await getAuthToken();
 */
export async function getAuthToken() {
  try {
    return await loadToken();
  } catch (err) {
    throw new Error('No authentication token found');
  }
}

// Export all functions as default object as well
export default {
  createTunnel,
  createPersistentTunnel,
  setAuthToken,
  getAuthToken
};
