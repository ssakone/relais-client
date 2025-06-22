import { join } from 'path';
import { readFile, writeFile, access } from 'fs/promises';
import { debug, errorWithTimestamp } from './debug.js';

const RELAIS_CONFIG_FILE = join(process.cwd(), 'relais.json');

/**
 * Save deployment configuration to relais.json
 * @param {Object} config - Deployment configuration
 * @param {string} config.id - Deployment ID
 * @param {string} config.folder - Project folder path
 * @param {string} config.type - Deployment type
 * @param {string} config.state - Last deployment state
 * @param {string} config.domain - Deployment domain (if deployed)
 */
export async function saveDeployConfig(config) {
  try {
    const configData = {
      id: config.id,
      folder: config.folder,
      type: config.type,
      state: config.state,
      domain: config.domain || null,
      lastDeployed: new Date().toISOString(),
      ...config
    };

    await writeFile(RELAIS_CONFIG_FILE, JSON.stringify(configData, null, 2));
    debug('Deployment config saved:', configData);
  } catch (error) {
    debug('Failed to save deployment config:', error.message);
    // Don't throw error for config save failures
  }
}

/**
 * Load deployment configuration from relais.json
 * @returns {Object|null} Deployment configuration or null if not found
 */
export async function loadDeployConfig() {
  try {
    await access(RELAIS_CONFIG_FILE);
    const configData = await readFile(RELAIS_CONFIG_FILE, 'utf-8');
    const config = JSON.parse(configData);
    
    debug('Deployment config loaded:', config);
    return config;
  } catch (error) {
    debug('No deployment config found or failed to load:', error.message);
    return null;
  }
}

/**
 * Check if deployment configuration exists
 * @returns {boolean} True if config file exists
 */
export async function hasDeployConfig() {
  try {
    await access(RELAIS_CONFIG_FILE);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Update deployment state in existing config
 * @param {string} state - New deployment state
 * @param {string} domain - Deployment domain (optional)
 */
export async function updateDeployState(state, domain = null) {
  try {
    const config = await loadDeployConfig();
    if (config) {
      config.state = state;
      if (domain) {
        config.domain = domain;
      }
      config.lastUpdated = new Date().toISOString();
      await saveDeployConfig(config);
    }
  } catch (error) {
    debug('Failed to update deployment state:', error.message);
  }
} 