#!/usr/bin/env node

import { Socket } from 'net';
import https from 'https';
import dns from 'dns/promises';
import { execSync } from 'child_process';

const RELAY_SERVER = 'tcp.relais.dev:1080';
const HEALTH_URL = 'https://relais.dev/api/health';

console.log('🔍 Diagnostic réseau pour Relais Tunnel\n');

async function checkDNS() {
  console.log('1. Vérification DNS...');
  try {
    const addresses = await dns.resolve4('relais.dev');
    console.log('   ✅ DNS résolu: relais.dev ->', addresses.join(', '));
    
    const relayIP = RELAY_SERVER.split(':')[0];
    try {
      const hostnames = await dns.reverse(relayIP);
      console.log(`   ℹ️  Reverse DNS pour ${relayIP}:`, hostnames.join(', '));
    } catch (err) {
      console.log(`   ℹ️  Pas de reverse DNS pour ${relayIP}`);
    }
  } catch (err) {
    console.log('   ❌ Erreur DNS:', err.message);
  }
  console.log('');
}

async function checkHealthEndpoint() {
  console.log('2. Test du endpoint de santé HTTPS...');
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    https.get(HEALTH_URL, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        console.log(`   ✅ HTTPS fonctionne (${responseTime}ms)`);
        console.log(`   Status: ${res.statusCode}`);
        try {
          const json = JSON.parse(data);
          console.log(`   Réponse: ${json.message}`);
        } catch (e) {
          console.log('   Réponse:', data.substring(0, 100));
        }
        resolve();
      });
    }).on('error', (err) => {
      console.log('   ❌ Erreur HTTPS:', err.message);
      resolve();
    });
  });
  console.log('');
}

async function checkTCPConnection() {
  console.log('3. Test de connexion TCP au serveur de tunnel...');
  const [host, port] = RELAY_SERVER.split(':');
  
  return new Promise((resolve) => {
    const socket = new Socket();
    const startTime = Date.now();
    let connected = false;
    
    const timeout = setTimeout(() => {
      if (!connected) {
        console.log(`   ❌ Timeout après 10 secondes`);
        socket.destroy();
        resolve();
      }
    }, 10000);
    
    socket.connect(parseInt(port), host, () => {
      connected = true;
      clearTimeout(timeout);
      const connectionTime = Date.now() - startTime;
      console.log(`   ✅ Connexion TCP établie (${connectionTime}ms)`);
      console.log(`   Local: ${socket.localAddress}:${socket.localPort}`);
      console.log(`   Remote: ${socket.remoteAddress}:${socket.remotePort}`);
      socket.end();
      resolve();
    });
    
    socket.on('error', (err) => {
      clearTimeout(timeout);
      console.log(`   ❌ Erreur TCP: ${err.message}`);
      resolve();
    });
  });
  console.log('');
}

async function checkPing() {
  console.log('4. Test ping...');
  const host = RELAY_SERVER.split(':')[0];
  
  try {
    const cmd = process.platform === 'win32' 
      ? `ping -n 4 ${host}` 
      : `ping -c 4 ${host}`;
    
    const result = execSync(cmd, { encoding: 'utf8' });
    const lines = result.split('\n').filter(line => line.trim());
    
    // Afficher les statistiques de ping
    lines.forEach(line => {
      if (line.includes('ms') || line.includes('loss') || line.includes('avg')) {
        console.log('   ', line.trim());
      }
    });
    
    console.log('   ✅ Ping réussi');
  } catch (err) {
    console.log('   ❌ Ping échoué:', err.message);
  }
  console.log('');
}

async function checkMTU() {
  console.log('5. Test MTU (Maximum Transmission Unit)...');
  const host = RELAY_SERVER.split(':')[0];
  
  if (process.platform === 'darwin' || process.platform === 'linux') {
    try {
      // Test avec différentes tailles de paquets
      const sizes = [1500, 1400, 1300];
      for (const size of sizes) {
        try {
          const cmd = `ping -c 1 -D -s ${size - 28} ${host}`;
          execSync(cmd, { encoding: 'utf8' });
          console.log(`   ✅ MTU ${size} fonctionne`);
        } catch (err) {
          console.log(`   ❌ MTU ${size} trop grand`);
          break;
        }
      }
    } catch (err) {
      console.log('   ⚠️  Impossible de tester MTU:', err.message);
    }
  } else {
    console.log('   ℹ️  Test MTU non disponible sur cette plateforme');
  }
  console.log('');
}

async function checkFirewall() {
  console.log('6. Indices de pare-feu/filtrage...');
  
  // Tester plusieurs ports communs
  const testPorts = [
    { port: 80, name: 'HTTP' },
    { port: 443, name: 'HTTPS' },
    { port: 22, name: 'SSH' },
    { port: 1080, name: 'Relay' }
  ];
  
  const host = RELAY_SERVER.split(':')[0];
  
  for (const test of testPorts) {
    await new Promise((resolve) => {
      const socket = new Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        console.log(`   ⚠️  Port ${test.port} (${test.name}): Pas de réponse`);
        resolve();
      }, 3000);
      
      socket.connect(test.port, host, () => {
        clearTimeout(timeout);
        console.log(`   ✅ Port ${test.port} (${test.name}): Accessible`);
        socket.end();
        resolve();
      });
      
      socket.on('error', () => {
        clearTimeout(timeout);
        console.log(`   ❌ Port ${test.port} (${test.name}): Refusé/Filtré`);
        resolve();
      });
    });
  }
  console.log('');
}

async function runDiagnostics() {
  console.log(`Serveur cible: ${RELAY_SERVER}`);
  console.log(`Plateforme: ${process.platform}`);
  console.log(`Node.js: ${process.version}\n`);
  
  await checkDNS();
  await checkHealthEndpoint();
  await checkTCPConnection();
  await checkPing();
  await checkMTU();
  await checkFirewall();
  
  console.log('📊 Résumé du diagnostic:');
  console.log('   - Si HTTPS fonctionne mais pas TCP 1080: Problème de pare-feu/ISP');
  console.log('   - Si ping fonctionne mais pas TCP: Port bloqué');
  console.log('   - Si MTU < 1500: Fragmentation réseau');
  console.log('   - Si connexion TCP lente: Problème de latence/routing');
}

// Run diagnostics if called directly
if (typeof require !== 'undefined' && require.main === module) {
  runDiagnostics().catch(console.error);
} else if (typeof import !== 'undefined' && import.meta && import.meta.url === `file://${process.argv[1]}`) {
  runDiagnostics().catch(console.error);
}

export { runDiagnostics }; 