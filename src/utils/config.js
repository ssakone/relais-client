import { join } from 'path';
import { homedir, platform } from 'os';
import { mkdir, writeFile, readFile, access } from 'fs/promises';
import { constants } from 'fs';

export async function getConfigDir() {
  let configDir;
  switch (platform()) {
    case 'win32':
      configDir = join(process.env.APPDATA, 'relais-client');
      break;
    case 'darwin':
      configDir = join(homedir(), 'Library', 'Application Support', 'relais-client');
      break;
    default:
      configDir = join(homedir(), '.config', 'relais-client');
  }

  try {
    await mkdir(configDir, { recursive: true });
    
    // Test write permissions
    try {
      await access(configDir, constants.W_OK);
    } catch (permErr) {
      throw new Error(`Configuration directory exists but is not writable: ${configDir}. Please check permissions.`);
    }
    
    return configDir;
  } catch (err) {
    if (err.message.includes('not writable')) {
      throw err;
    }
    throw new Error(`Unable to create configuration directory ${configDir}: ${err.message}`);
  }
}

export async function saveToken(token) {
  try {
    const configDir = await getConfigDir();
    const tokenFile = join(configDir, 'token');
    
    console.log(`Saving token to: ${tokenFile}`);
    await writeFile(tokenFile, token.trim(), { mode: 0o600 }); // Secure permissions
    
    // Verify the token was saved correctly
    const savedToken = await readFile(tokenFile, 'utf8');
    if (savedToken.trim() !== token.trim()) {
      throw new Error('Token verification failed after save');
    }
    
    console.log('Token saved successfully');
  } catch (err) {
    throw new Error(`Error saving token: ${err.message}`);
  }
}

export async function loadToken() {
  try {
    const configDir = await getConfigDir();
    const tokenFile = join(configDir, 'token');
    
    // Check if file exists first
    try {
      await access(tokenFile, constants.R_OK);
    } catch (accessErr) {
      if (accessErr.code === 'ENOENT') {
        throw new Error('No token found. Please use the set-token command first.');
      } else {
        throw new Error(`Token file exists but is not readable: ${tokenFile}. Please check permissions.`);
      }
    }
    
    const token = await readFile(tokenFile, 'utf8');
    const trimmedToken = token.trim();
    
    if (!trimmedToken) {
      throw new Error('Token file is empty. Please use the set-token command to save a valid token.');
    }

    return trimmedToken;
  } catch (err) {
    throw err; // Re-throw the error with the original message
  }
}
