import { join } from 'path';
import { homedir, platform } from 'os';
import { mkdir, writeFile, readFile } from 'fs/promises';

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
    return configDir;
  } catch (err) {
    throw new Error(`Unable to create configuration directory: ${err.message}`);
  }
}

export async function saveToken(token) {
  try {
    const configDir = await getConfigDir();
    const tokenFile = join(configDir, 'token');
    await writeFile(tokenFile, token);
  } catch (err) {
    throw new Error(`Error saving token: ${err.message}`);
  }
}

export async function loadToken() {
  try {
    const configDir = await getConfigDir();
    const tokenFile = join(configDir, 'token');
    const token = await readFile(tokenFile, 'utf8');
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      throw new Error('Token file exists but is empty');
    }
    return trimmedToken;
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('No token found. Use set-token command to save a token first');
    }
    throw new Error(`Error loading token: ${err.message}`);
  }
}
