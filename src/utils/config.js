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
    console.log('Token saved successfully!');
  } catch (err) {
    throw new Error(`Error saving token: ${err.message}`);
  }
}

export async function loadToken() {
  try {
    const configDir = await getConfigDir();
    const tokenFile = join(configDir, 'token');
    const token = await readFile(tokenFile, 'utf8');
    return token.trim();
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw new Error(`Error loading token: ${err.message}`);
  }
}
