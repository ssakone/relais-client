import { join, isAbsolute } from 'path';
import { readFile, writeFile, access } from 'fs/promises';
import { debug, errorWithTimestamp } from './debug.js';

// Allow overriding the deploy config file path (default: ./relais.json)
let deployConfigFilePath = join(process.cwd(), 'relais.json');

export function setDeployConfigFile(filePath) {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return;
    }
    deployConfigFilePath = isAbsolute(filePath) ? filePath : join(process.cwd(), filePath);
    debug('Using deploy config file:', deployConfigFilePath);
  } catch (err) {
    // Fallback silently to default on any error
    errorWithTimestamp('Failed to set deploy config file:', err.message);
  }
}

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

    await writeFile(deployConfigFilePath, JSON.stringify(configData, null, 2));
    debug('Deployment config saved');
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
    await access(deployConfigFilePath);
    const configData = await readFile(deployConfigFilePath, 'utf-8');
    const config = JSON.parse(configData);
    
    debug('Deployment config loaded');
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
    await access(deployConfigFilePath);
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