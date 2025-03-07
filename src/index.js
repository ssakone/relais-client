#!/usr/bin/env node

import { Command } from 'commander';
import { saveToken, loadToken } from './utils/config.js';
import { connectAndServe } from './tunnel/tunnel-service.js';
import { debug } from './utils/debug.js';

const program = new Command();

// Configuration par défaut
const DEFAULT_SERVER = '104.168.64.151:1080';
const DEFAULT_PROTOCOL = 'http';

program
  .name('relais-node-client')
  .description('Client Node.js pour le service de tunnel relais')
  .version('1.0.2');

program
  .command('set-token <token>')
  .description('Sauvegarder un token d\'authentification pour une utilisation ultérieure')
  .action(async (token) => {
    try {
      await saveToken(token);
    } catch (err) {
      console.error(err.message);
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
      console.error('Le port local est obligatoire');
      process.exit(1);
    }

    if (!options.token) {
      try {
        options.token = await loadToken();
      } catch (err) {
        console.error(err.message);
      }
    }

    if (!options.token) {
      console.error('Le token est obligatoire. Utilisez -k ou sauvegardez un token avec la commande set-token');
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

    while (true) {
      try {
        await connectAndServe(options);
      } catch (err) {
        if (err.message.includes('Token')) {
          console.error('Erreur d\'authentification:', err.message);
          process.exit(1);
        }
        console.error('Erreur de connexion:', err.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  });

program.parse();
