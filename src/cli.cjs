#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const url = require('url');

// Default configuration
const DEFAULT_SERVER = '104.168.64.151:1080';
const DEFAULT_PROTOCOL = 'http';

let debug = (...args) => {
  if (process.env.DEBUG) {
    console.log(...args);
  }
};

const program = new Command();

program
  .name('relais')
  .description('Node.js client for the relay tunnel service')
  .version('1.0.2');

program
  .command('set-token <token>')
  .description('Save an authentication token for future use')
  .action(async (token) => {
    const { saveToken } = await import('./utils/config.js');
    try {
      await saveToken(token);
      console.log('Token saved successfully');
    } catch (err) {
      console.error('Error saving token:', err.message);
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
      remote: options.remote
    });

    if (!options.port) {
      console.error('Error: Local port is required');
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

    while (true) {
      try {
        await connectAndServe(options);
      } catch (err) {
        if (err.message.includes('Token')) {
          console.error('This service requires authentication. Use -k <token> or the set-token command');
          process.exit(1);
        }
        console.error('Connection error:', err.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  });

program.parse();
