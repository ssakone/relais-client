#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const url = require('url');

// Default configuration
const DEFAULT_SERVER = 'tcp.relais.dev:1080';
const DEFAULT_PROTOCOL = 'http';

let debug = (...args) => {
  if (process.env.DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}]`, ...args);
  }
};

let errorWithTimestamp = (...args) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}]`, ...args);
};

const program = new Command();

program
  .name('relais')
  .description('Node.js client for the relay tunnel service')
  .version('1.5.1');

// Libère le raccourci -h pour l'option --host et déplace l'aide sur -H
program.helpOption('-H, --help', 'Display help for command');

program
  .command('set-token <token>')
  .description('Save an authentication token for future use')
  .action(async (token) => {
    const { saveToken } = await import('./utils/config.js');
    try {
      await saveToken(token);
      console.log('Token saved successfully');
    } catch (err) {
      errorWithTimestamp('Error saving token:', err.message);
      process.exit(1);
    }
  });

program
  .command('deploy [folder]', { hidden: true })
  .description('🚀 Deploy a project folder to Relais platform (experimental)')
  .option('-t, --type <type>', 'Deployment type (web, react, static, node, nest)', 'web')
  .option('-d, --domain <domain>', 'Custom domain for deployment')
  .option('-f, --file <path>', 'Path to deploy config JSON (default: relais.json)')
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
      
      // Configure and check deploy config file to determine if this is an update
      const { loadDeployConfig, hasDeployConfig, setDeployConfigFile } = await import('./utils/deploy-config.js');
      if (options.file) {
        setDeployConfigFile(options.file);
      }
      const configExists = await hasDeployConfig();
      
      // Handle current directory specification
      if (deployFolder === '.') {
        deployFolder = process.cwd();
        debug('Using current directory:', deployFolder);
      }
      
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
            debug(`Using saved configuration (UPDATE MODE)`);
            debug(`Folder: ${deployFolder}`);
            debug(`Type: ${deployType}`);
            debug(`Domain: ${deployDomain || 'None'}`);
            if (options.domain && options.domain !== config.domain) {
              debug(`Domain changed from: ${config.domain || 'None'} to: ${options.domain}`);
            }
            debug(`Last deployment: ${config.lastDeployed || 'Unknown'}`);
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
            debug('Existing configuration found for this folder - UPDATE MODE');
            if (options.domain && options.domain !== config.domain) {
              debug(`Domain changed from: ${config.domain || 'None'} to: ${options.domain}`);
            }
          } else {
            debug('Existing configuration found but for different folder - CREATE MODE');
          }
        }
      }
      
      debug('Starting deployment...');
      debug(`Folder: ${deployFolder}`);
      debug(`Type: ${deployType}`);
      if (deployDomain) debug(`Domain: ${deployDomain}`);
      debug(`Mode: ${isUpdate ? 'UPDATE' : 'CREATE'}`);
      
      const { deployService } = await import('./services/deploy.js');
      const result = await deployService.deploy(deployFolder, deployType, isUpdate, deployDomain);
      
      debug('Upload successful.');
      debug('Waiting for deployment status...');
      
      // Poll deployment status after showing upload success
      await deployService.pollDeploymentStatus(result.id);
      
    } catch (error) {
      errorWithTimestamp('Deployment failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('tunnel')
  .description('Create a tunnel to expose local services')
  .option('-s, --server <address>', 'Relay server address', DEFAULT_SERVER)
  .option('-h, --host <host>', 'Local service host', 'localhost')
  .option('-p, --port <port>', 'Local service port')
  .option('-k, --token <token>', 'Authentication token (optional)')
  .option('-d, --domain <domain>', 'Custom domain')
  .option('-r, --remote <port>', 'Desired remote port')
  .option('-t, --type <type>', 'Protocol type (http or tcp)', DEFAULT_PROTOCOL)
  .option('--timeout <seconds>', 'Tunnel establishment timeout in seconds', '30')
  .option('--health-check', 'Enable tunnel health checking (default: enabled)', true)
  .option('--no-health-check', 'Disable tunnel health checking')
  .option('--health-check-interval <seconds>', 'Health check interval in seconds', '30')
  .option('-v, --verbose', 'Enable detailed logging')
  .action(async (options) => {
    if (options.verbose) {
      process.env.DEBUG = 'true';
    }

    const { loadToken } = await import('./utils/config.js');
    const { connectAndServe } = await import('./tunnel/tunnel-service.js');

    debug('Configuration:', {
      server: options.server,
      host: options.host,
      port: options.port,
      type: options.type,
      domain: options.domain,
      remote: options.remote,
      timeout: options.timeout,
      healthCheck: options.healthCheck,
      healthCheckInterval: options.healthCheckInterval
    });

    if (!options.port) {
      errorWithTimestamp('Error: Local port is required');
      process.exit(1);
    }

    // Try to load token if not provided but don't require it
    if (!options.token) {
      try {
        options.token = await loadToken();
        debug('Token loaded from configuration');
      } catch (err) {
        debug('No token found, continuing without token');
      }
    }

    // Import failure tracker for persistent connection
    const { ConnectionFailureTracker } = await import('./utils/failure-tracker.js');
    const failureTracker = new ConnectionFailureTracker();
    debug('Mode agent activé - Reconnexion persistante en cas d\'erreur réseau');

    while (true) {
      try {
        // Agent mode: Never stop reconnecting for network errors, only for authentication issues
        await connectAndServe(options, failureTracker);
        
        // Reset failure tracker on successful connection
        failureTracker.reset();
        failureTracker.recordSuccessfulConnection();
        
      } catch (err) {
        if (err.message.includes('Token') || err.message.includes('Authentication')) {
          errorWithTimestamp('This service requires authentication. Use -k <token> or the set-token command');
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
          
          debug('Serveur rétabli - Reprise de la connexion tunnel...');
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

        // Handle tunnel health check triggered reconnection
        if (err.message.includes('Tunnel health check triggered reconnection')) {
          errorWithTimestamp('🔄 Reconnexion du tunnel déclenchée par la vérification de santé...');
          failureTracker.reset();
          // Immediate retry without backoff
          continue;
        }

        // Determine error type and handle accordingly
        if (err.message.includes('Connection closed by server')) {
          failureTracker.recordServerClosure();
          const backoffDuration = failureTracker.getBackoffDuration();
          errorWithTimestamp(`Server closed connection: ${err.message}; reconnecting in ${backoffDuration}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffDuration));
        } else if (failureTracker.isNetworkError(err)) {
          // Network errors - continue trying indefinitely with backoff
          failureTracker.recordNetworkError();

          const backoffDuration = failureTracker.getBackoffDuration();
          errorWithTimestamp(`Network error: ${err.message}; reconnecting in ${backoffDuration}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffDuration));
        } else {
          // Other errors - treat as network errors for agent mode
          failureTracker.recordNetworkError();

          const backoffDuration = failureTracker.getBackoffDuration();
          errorWithTimestamp(`Connection error: ${err.message}; reconnecting in ${backoffDuration}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffDuration));
        }
      }
    }
  });

program.parse();
