#!/usr/bin/env node
/**
 * Man-in-the-Middle Test Script
 *
 * Ce script crée un proxy TCP qui intercepte et affiche toutes les données
 * échangées entre le client et le serveur Relais.
 *
 * Usage:
 *   1. Lancer ce script: node test-mitm.js
 *   2. Dans un autre terminal, lancer le client avec le proxy:
 *
 *      Mode NON-CHIFFRÉ (vous verrez le token en clair):
 *      relais tunnel -p 8001 -s localhost:9999
 *
 *      Mode CHIFFRÉ (vous verrez des données binaires):
 *      relais tunnel -p 8001 -s localhost:9999 --secure
 */

const net = require('net');

const PROXY_PORT = 9999;
const TARGET_HOST = 'tcp.relais.dev';
const TARGET_PORT = 1080;

// Couleurs pour la console
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function hexDump(buffer, maxBytes = 200) {
  const bytes = buffer.slice(0, maxBytes);
  let hex = '';
  let ascii = '';
  let result = '';

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    hex += byte.toString(16).padStart(2, '0') + ' ';
    ascii += (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';

    if ((i + 1) % 16 === 0) {
      result += `  ${hex} | ${ascii}\n`;
      hex = '';
      ascii = '';
    }
  }

  if (hex) {
    result += `  ${hex.padEnd(48)} | ${ascii}\n`;
  }

  if (buffer.length > maxBytes) {
    result += `  ... (${buffer.length - maxBytes} more bytes)\n`;
  }

  return result;
}

function analyzeData(data, direction) {
  const str = data.toString('utf8');
  const analysis = {
    isJson: false,
    isEncrypted: false,
    containsToken: false,
    command: null,
  };

  // Essayer de parser comme JSON
  try {
    const json = JSON.parse(str.trim());
    analysis.isJson = true;
    analysis.command = json.command;

    // Vérifier si le token est visible
    if (json.token && json.token.startsWith('rl_')) {
      analysis.containsToken = true;
    }
  } catch {
    // Pas du JSON valide
    // Vérifier si c'est des données binaires (chiffrées)
    const nonPrintable = data.filter(b => b < 32 || b > 126).length;
    const ratio = nonPrintable / data.length;

    if (ratio > 0.3) {
      analysis.isEncrypted = true;
    }
  }

  // Vérifier si le token apparaît en clair dans les données brutes
  if (str.includes('rl_') || str.includes('token')) {
    analysis.containsToken = true;
  }

  return analysis;
}

function formatTimestamp() {
  return new Date().toISOString().split('T')[1].slice(0, -1);
}

const server = net.createServer((clientSocket) => {
  const clientAddr = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
  console.log(`\n${colors.green}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.green}[${formatTimestamp()}] New connection from: ${clientAddr}${colors.reset}`);
  console.log(`${colors.green}═══════════════════════════════════════════════════════════════${colors.reset}\n`);

  // Connecter au serveur cible
  const serverSocket = net.createConnection({
    host: TARGET_HOST,
    port: TARGET_PORT,
  }, () => {
    console.log(`${colors.cyan}[${formatTimestamp()}] Connected to ${TARGET_HOST}:${TARGET_PORT}${colors.reset}\n`);
  });

  let messageCount = 0;

  // Client -> Server
  clientSocket.on('data', (data) => {
    messageCount++;
    const analysis = analyzeData(data, 'CLIENT->SERVER');

    console.log(`${colors.yellow}┌─────────────────────────────────────────────────────────────┐${colors.reset}`);
    console.log(`${colors.yellow}│ [${formatTimestamp()}] CLIENT ──► SERVER (${data.length} bytes) #${messageCount}${colors.reset}`);
    console.log(`${colors.yellow}└─────────────────────────────────────────────────────────────┘${colors.reset}`);

    if (analysis.isJson) {
      console.log(`${colors.red}  ⚠️  JSON EN CLAIR DÉTECTÉ!${colors.reset}`);
      if (analysis.command) {
        console.log(`${colors.gray}  Command: ${analysis.command}${colors.reset}`);
      }
      if (analysis.containsToken) {
        console.log(`${colors.red}  🔓 TOKEN VISIBLE EN CLAIR! (VULNÉRABLE)${colors.reset}`);
      }
      console.log(`${colors.gray}  Content:${colors.reset}`);
      console.log(`${colors.gray}${data.toString('utf8').split('\n').map(l => '    ' + l).join('\n')}${colors.reset}`);
    } else if (analysis.isEncrypted) {
      console.log(`${colors.green}  ✅ DONNÉES CHIFFRÉES (binaire)${colors.reset}`);
      console.log(`${colors.gray}  Hex dump:${colors.reset}`);
      console.log(`${colors.gray}${hexDump(data)}${colors.reset}`);
    } else {
      console.log(`${colors.gray}  Raw data:${colors.reset}`);
      console.log(`${colors.gray}${hexDump(data)}${colors.reset}`);
    }
    console.log();

    serverSocket.write(data);
  });

  // Server -> Client
  serverSocket.on('data', (data) => {
    messageCount++;
    const analysis = analyzeData(data, 'SERVER->CLIENT');

    console.log(`${colors.blue}┌─────────────────────────────────────────────────────────────┐${colors.reset}`);
    console.log(`${colors.blue}│ [${formatTimestamp()}] SERVER ──► CLIENT (${data.length} bytes) #${messageCount}${colors.reset}`);
    console.log(`${colors.blue}└─────────────────────────────────────────────────────────────┘${colors.reset}`);

    if (analysis.isJson) {
      console.log(`${colors.magenta}  ℹ️  JSON en clair${colors.reset}`);
      if (analysis.command) {
        console.log(`${colors.gray}  Command: ${analysis.command}${colors.reset}`);
      }
      console.log(`${colors.gray}  Content:${colors.reset}`);
      console.log(`${colors.gray}${data.toString('utf8').split('\n').map(l => '    ' + l).join('\n')}${colors.reset}`);
    } else if (analysis.isEncrypted) {
      console.log(`${colors.green}  ✅ DONNÉES CHIFFRÉES (binaire)${colors.reset}`);
      console.log(`${colors.gray}  Hex dump:${colors.reset}`);
      console.log(`${colors.gray}${hexDump(data)}${colors.reset}`);
    } else {
      console.log(`${colors.gray}  Raw data:${colors.reset}`);
      console.log(`${colors.gray}${hexDump(data)}${colors.reset}`);
    }
    console.log();

    clientSocket.write(data);
  });

  // Gestion des erreurs et fermetures
  clientSocket.on('error', (err) => {
    console.log(`${colors.red}[Client Error] ${err.message}${colors.reset}`);
  });

  serverSocket.on('error', (err) => {
    console.log(`${colors.red}[Server Error] ${err.message}${colors.reset}`);
  });

  clientSocket.on('close', () => {
    console.log(`${colors.gray}[${formatTimestamp()}] Client disconnected${colors.reset}`);
    serverSocket.end();
  });

  serverSocket.on('close', () => {
    console.log(`${colors.gray}[${formatTimestamp()}] Server disconnected${colors.reset}`);
    clientSocket.end();
  });
});

server.listen(PROXY_PORT, () => {
  console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════════╗
║                    MITM PROXY - TEST SCRIPT                   ║
╠═══════════════════════════════════════════════════════════════╣
║  Proxy listening on port ${PROXY_PORT}                              ║
║  Forwarding to ${TARGET_HOST}:${TARGET_PORT}                          ║
╠═══════════════════════════════════════════════════════════════╣
║  TEST 1 - Mode NON-CHIFFRÉ (token visible):                   ║
║    relais tunnel -p 8001 -s localhost:${PROXY_PORT}                  ║
║                                                               ║
║  TEST 2 - Mode CHIFFRÉ (token protégé):                       ║
║    relais tunnel -p 8001 -s localhost:${PROXY_PORT} --secure         ║
╠═══════════════════════════════════════════════════════════════╣
║  ${colors.yellow}⚠️  En mode non-chiffré, vous verrez le token en clair!${colors.cyan}       ║
║  ${colors.green}✅ En mode chiffré, vous verrez des données binaires${colors.cyan}          ║
╚═══════════════════════════════════════════════════════════════╝${colors.reset}

Waiting for connections...
`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`${colors.red}Error: Port ${PROXY_PORT} is already in use${colors.reset}`);
  } else {
    console.error(`${colors.red}Server error: ${err.message}${colors.reset}`);
  }
  process.exit(1);
});
