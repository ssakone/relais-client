#!/usr/bin/env node

import { Command } from 'commander';
import { saveToken, loadToken, getConfigDir } from './utils/config.js';
import { connectAndServe } from './tunnel/tunnel-service.js';
import { ConnectionFailureTracker } from './utils/failure-tracker.js';
import { debug, errorWithTimestamp } from './utils/debug.js';
import { deployService } from './services/deploy.js';
import { loadDeployConfig, hasDeployConfig } from './utils/deploy-config.js';

const program = new Command();

// Configuration par défaut
const DEFAULT_SERVER = '104.168.64.151:1080';
const DEFAULT_PROTOCOL = 'http';

program
  .name('relais-node-client')
  .description('Client Node.js pour le service de tunnel relais')
  .version('1.3.2');

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
  .option('--timeout <seconds>', 'Délai d\'attente pour l\'établissement du tunnel en secondes', '30')
  .option('--restart-interval <minutes>', 'Intervalle de redémarrage du tunnel en minutes', '30')
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
      remote: options.remote,
      timeout: options.timeout,
      restartInterval: options.restartInterval
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

        // Handle health monitor connection loss specifically
        if (err.message.includes('Connection lost due to server health check failure')) {
          errorWithTimestamp('Connexion fermée par le monitoring de santé - Attente du rétablissement...');
          
          // Create a temporary health monitor to wait for server recovery
          const { HealthMonitor } = await import('./utils/health-monitor.js');
          const tempHealthMonitor = new HealthMonitor();
          await tempHealthMonitor.waitForServerRecovery();
          tempHealthMonitor.stop();
          
          console.log('🔄 Serveur rétabli - Reprise de la connexion tunnel...');
          // Continue to reconnect immediately without backoff
          continue;
        }

        // Handle tunnel establishment timeout specifically
        if (err.message.includes('Tunnel establishment timeout')) {
          const timeoutMatch = err.message.match(/(\d+) seconds/);
          const timeoutSeconds = timeoutMatch ? timeoutMatch[1] : '30';
          errorWithTimestamp(`⏱️  Établissement du tunnel trop lent (>${timeoutSeconds}s) - Nouvelle tentative...`);
          // Immediate retry for timeout, no backoff
          continue;
        }

        if (err.message.includes('Tunnel restart interval reached')) {
          console.log('🔄 Redémarrage périodique du tunnel');
          failureTracker.reset();
          continue;
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
  .command('deploy [folder]')
  .description('🚀 Deploy a project folder to Relais platform (experimental)')
  .option('-t, --type <type>', 'Deployment type (web, api, etc.)', 'web')
  .option('-d, --domain <domain>', 'Custom domain for deployment')
  .option('-v, --verbose', 'Enable detailed logging')
  .action(async (folder, options) => {
    if (options.verbose) {
      process.env.DEBUG = 'true';
    }

    try {
      let deployFolder = folder;
      let deployType = options.type;
      let deployDomain = options.domain;
      let isUpdate = false;
      
      // Check if relais.json exists to determine if this is an update
      const configExists = await hasDeployConfig();
      
      // If no folder specified, try to load from config
      if (!deployFolder) {
        if (configExists) {
          const config = await loadDeployConfig();
          if (config) {
            deployFolder = config.folder;
            deployType = config.type;
            // Only use saved domain if no domain was specified via CLI
            if (!deployDomain) {
              deployDomain = config.domain;
            }
            isUpdate = true;
            console.log(`📄 Using saved configuration (UPDATE MODE):`);
            console.log(`   Folder: ${deployFolder}`);
            console.log(`   Type: ${deployType}`);
            console.log(`   Domain: ${deployDomain || 'None'}`);
            if (options.domain && options.domain !== config.domain) {
              console.log(`   🔄 Domain changed from: ${config.domain || 'None'} to: ${options.domain}`);
            }
            console.log(`   Last deployment: ${config.lastDeployed || 'Unknown'}`);
            console.log('');
          } else {
            errorWithTimestamp('No folder specified and no saved configuration found.');
            console.log('Usage: relais deploy <folder> or save a configuration first.');
            process.exit(1);
          }
        } else {
          errorWithTimestamp('No folder specified and no saved configuration found.');
          console.log('Usage: relais deploy <folder> or save a configuration first.');
          process.exit(1);
        }
      } else {
        // Folder was specified, check if we should update existing config
        if (configExists) {
          const config = await loadDeployConfig();
          if (config && config.folder === deployFolder) {
            isUpdate = true;
            // Only use saved domain if no domain was specified via CLI
            if (!deployDomain) {
              deployDomain = config.domain;
            }
            console.log('📄 Existing configuration found for this folder - UPDATE MODE');
            if (options.domain && options.domain !== config.domain) {
              console.log(`   🔄 Domain changed from: ${config.domain || 'None'} to: ${options.domain}`);
            }
          } else {
            console.log('📄 Existing configuration found but for different folder - CREATE MODE');
          }
        }
      }
      
      console.log('Starting deployment...');
      console.log(`📁 Folder: ${deployFolder}`);
      console.log(`🏷️  Type: ${deployType}`);
      if (deployDomain) console.log(`🌐 Domain: ${deployDomain}`);
      console.log(`🔄 Mode: ${isUpdate ? 'UPDATE' : 'CREATE'}`);
      
      const result = await deployService.deploy(deployFolder, deployType, isUpdate, deployDomain);
      
      console.log('✅ Upload successful!');
      console.log('');

      
      // Poll deployment status after showing upload success
      await deployService.pollDeploymentStatus(result.id);
      console.log('')
      
    } catch (error) {
      errorWithTimestamp('Deployment failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('diagnose')
  .description('🔍 Diagnostiquer les problèmes de connexion réseau')
  .action(async () => {
    try {
      const { runDiagnostics } = await import('./utils/network-diagnostic.js');
      await runDiagnostics();
    } catch (err) {
      errorWithTimestamp('Erreur lors du diagnostic:', err.message);
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
