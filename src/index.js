#!/usr/bin/env node

import { Command } from 'commander';
import { saveToken, loadToken, getConfigDir } from './utils/config.js';
import { connectAndServe } from './tunnel/tunnel-service.js';
import { ConnectionFailureTracker } from './utils/failure-tracker.js';
import { debug, errorWithTimestamp } from './utils/debug.js';

const program = new Command();

// Configuration par défaut
const DEFAULT_SERVER = '104.168.64.151:1080';
const DEFAULT_PROTOCOL = 'http';

program
  .name('relais-node-client')
  .description('Client Node.js pour le service de tunnel relais')
  .version('1.2.1');

program
  .command('set-token <token>')
  .description('Sauvegarder un token d\'authentification pour une utilisation ultérieure')
  .action(async (token) => {
    try {
      await saveToken(token);
      console.log('Token saved successfully');
    } catch (err) {
      errorWithTimestamp('Error saving token:', err.message);
      process.exit(1);
    }
  });

program
  .command('check-token')
  .description('Vérifier si un token est sauvegardé et l\'afficher')
  .action(async () => {
    try {
      const token = await loadToken();
      console.log('Saved token found:', token.substring(0, 10) + '...' + token.substring(token.length - 4));
      console.log('Token length:', token.length);
    } catch (err) {
      errorWithTimestamp('No valid token found:', err.message);
      process.exit(1);
    }
  });



program
  .command('tunnel')
  .description('Établir un tunnel')
  .option('-s, --server <address>', 'Adresse du serveur relais', DEFAULT_SERVER)
  .option('-h, --host <host>', 'Adresse locale du service à exposer', 'localhost')
  .option('-p, --port <port>', 'Port local du service à exposer')
  .option('-k, --token <token>', 'Token d\'authentification')
  .option('-d, --domain <domain>', 'Domaine personnalisé')
  .option('-r, --remote <port>', 'Port distant souhaité')
  .option('-t, --type <type>', 'Type de protocole (http ou tcp)', DEFAULT_PROTOCOL)
  .option('-v, --verbose', 'Activer les logs détaillés')
  .action(async (options) => {
    if (options.verbose) {
      process.env.DEBUG = 'true';
    }

    if (!options.port) {
      errorWithTimestamp('Le port local est obligatoire');
      process.exit(1);
    }

    if (!options.token) {
      try {
        options.token = await loadToken();
        console.log('Using saved token');
      } catch (err) {
        console.log(`Token loading failed: ${err.message}`);
        // Continue without token - some servers might allow it
      }
    }

    if (!options.token) {
      errorWithTimestamp('Le token est obligatoire. Utilisez -k ou sauvegardez un token avec la commande set-token');
      process.exit(1);
    }

    debug('Configuration:', {
      server: options.server,
      host: options.host,
      port: options.port,
      type: options.type,
      domain: options.domain,
      remote: options.remote
    });

    // Create failure tracker - Agent mode always enabled
    const failureTracker = new ConnectionFailureTracker();
    console.log('🤖 Mode agent activé - Reconnexion persistante en cas d\'erreur réseau');

    while (true) {
      try {
        // Agent mode: Never stop reconnecting for network errors, only for authentication issues

        await connectAndServe(options, failureTracker);
        
        // Reset failure tracker on successful connection
        failureTracker.reset();
        
      } catch (err) {
        if (err.message.includes('Token') || err.message.includes('Authentication')) {
          errorWithTimestamp('Erreur d\'authentification:', err.message);
          process.exit(1);
        }

        // Determine error type and handle accordingly
        if (err.message.includes('Connection closed by server')) {
          console.log(`[DEBUG] Server closed connection detected: "${err.message}"`);
          failureTracker.recordServerClosure();
          const backoffDuration = failureTracker.getBackoffDuration();
          errorWithTimestamp(`Server closed connection: ${err.message}; reconnecting in ${backoffDuration}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffDuration));
        } else if (failureTracker.isNetworkError(err)) {
          // Network errors - continue trying indefinitely with backoff
          console.log(`[DEBUG] Network error detected: "${err.message}"`);
          failureTracker.recordNetworkError();
          const backoffDuration = failureTracker.getBackoffDuration();
          errorWithTimestamp(`Network error: ${err.message}; reconnecting in ${backoffDuration}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffDuration));
        } else {
          // Other errors - treat as network errors for agent mode
          console.log(`[DEBUG] Other connection error: "${err.message}"`);
          failureTracker.recordNetworkError();
          const backoffDuration = failureTracker.getBackoffDuration();
          errorWithTimestamp(`Connection error: ${err.message}; reconnecting in ${backoffDuration}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffDuration));
        }
      }
    }
  });

program
  .command('debug-config')
  .description('Afficher des informations de débogage sur la configuration')
  .action(async () => {
    try {
      const { getConfigDir } = await import('./utils/config.js');
      const { access, stat } = await import('fs/promises');
      const { constants } = await import('fs');
      const { join } = await import('path');
      
      console.log('=== Configuration Debug Information ===');
      console.log('Platform:', process.platform);
      console.log('Home directory:', require('os').homedir());
      
      try {
        const configDir = await getConfigDir();
        console.log('Config directory:', configDir);
        
        const stats = await stat(configDir);
        console.log('Directory exists:', true);
        console.log('Directory permissions:', stats.mode.toString(8));
        
        // Check if we can write to the directory
        try {
          await access(configDir, constants.W_OK);
          console.log('Directory writable:', true);
        } catch (err) {
          console.log('Directory writable:', false, err.message);
        }
        
        // Check token file
        const tokenFile = join(configDir, 'token');
        try {
          const tokenStats = await stat(tokenFile);
          console.log('Token file exists:', true);
          console.log('Token file permissions:', tokenStats.mode.toString(8));
          console.log('Token file size:', tokenStats.size, 'bytes');
          
          try {
            await access(tokenFile, constants.R_OK);
            console.log('Token file readable:', true);
          } catch (readErr) {
            console.log('Token file readable:', false, readErr.message);
          }
        } catch (tokenErr) {
          if (tokenErr.code === 'ENOENT') {
            console.log('Token file exists:', false);
          } else {
            console.log('Token file error:', tokenErr.message);
          }
        }
      } catch (err) {
        console.log('Config directory error:', err.message);
      }
    } catch (err) {
      errorWithTimestamp('Debug failed:', err.message);
    }
  });

program.parse();
