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
 * Create a tunnel to expose a local service
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
 * @param {boolean} [options.verbose=false] - Enable detailed logging
 * @returns {Promise<Object>} Tunnel information
 *
 * @example
 * const tunnel = await createTunnel({
 *   port: '3000',
 *   type: 'http',
 *   verbose: true
 * });
 * console.log('Tunnel URL:', tunnel.url);
 */
export async function createTunnel(options) {
  // Set defaults
  const tunnelOptions = {
    host: 'localhost',
    server: 'tcp.relais.dev:1080',
    type: 'http',
    timeout: '30',
    restartInterval: '30',
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

  const failureTracker = new ConnectionFailureTracker();

  try {
    await connectAndServe(tunnelOptions, failureTracker);

    return {
      success: true,
      message: 'Tunnel created successfully'
    };
  } catch (err) {
    throw new Error(`Failed to create tunnel: ${err.message}`);
  }
}

/**
 * Create a tunnel with auto-reconnection on failures
 * This function will continuously try to reconnect if the connection is lost
 *
 * @param {Object} options - Same as createTunnel options
 * @returns {Promise<void>} Never resolves (runs indefinitely)
 *
 * @example
 * await createPersistentTunnel({
 *   port: '3000',
 *   type: 'http'
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
