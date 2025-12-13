import { Socket } from 'net';
import { TunnelRequest, SecureHandshakeInit } from '../models/messages.js';
import { setKeepAlive, setNoDelay, handleNewConnection, optimizeSocket } from '../network/connection.js';
import { debug, errorWithTimestamp } from '../utils/debug.js';
import { ConnectionFailureTracker } from '../utils/failure-tracker.js';
import { HealthMonitor } from '../utils/health-monitor.js';
import { TunnelHealthChecker } from '../utils/tunnel-health-checker.js';
import { createSpinner } from '../utils/terminal-spinner.js';
import { SecureChannel, SecureJSONDecoder, SecureJSONEncoder, encodeBinaryHandshake, BinaryHandshakeDecoder } from '../crypto/secure-channel.js';

// Utility function to read a complete JSON message from socket
function createJSONDecoder(socket) {
  let buffer = '';
  
  return {
    decode() {
      return new Promise((resolve, reject) => {
        function tryParse() {
          const newlineIndex = buffer.indexOf('\n');
          if (newlineIndex !== -1) {
            const jsonStr = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            try {
                          const message = JSON.parse(jsonStr);
            // Only log non-heartbeat messages to avoid spam
            if (message.command !== 'HEARTBEAT') {
              debug('JSON message received:', message);
            }
            resolve(message);
            } catch (err) {
              reject(new Error('JSON parsing error: ' + err.message));
            }
            return true;
          }
          return false;
        }

        // First check if we already have a complete message in the buffer.
        if (tryParse()) {
          return;
        }

        // Otherwise, set up listeners to receive more data.
        function onData(data) {
          buffer += data.toString();
          if (tryParse()) {
            cleanup();
          }
        }

        function onError(err) {
          cleanup();
          reject(err);
        }

        function onEnd() {
          cleanup();
          reject(new Error('Connection closed by server'));
        }

        // Handle the case where we destroy the socket locally (e.g. for a
        // scheduled restart). In that situation Node émet l'évènement "close"
        // mais pas forcément "end" ; sans ce listener le decode() pourrait
        // rester bloqué indéfiniment.
        function onClose() {
          cleanup();
          reject(new Error('Connection closed by server'));
        }

        function cleanup() {
          socket.removeListener('data', onData);
          socket.removeListener('error', onError);
          socket.removeListener('end', onEnd);
          socket.removeListener('close', onClose);
        }

        socket.on('data', onData);
        socket.on('error', onError);
        socket.on('end', onEnd);
        socket.on('close', onClose);
      });
    },
  };
}

// Heartbeat management for keeping connection alive
function startHeartbeatMonitoring(socket, lastHeartbeatReceived) {
  const heartbeatInterval = 30000; // 30 seconds to detect missing heartbeats
  const warningInterval = 120000; // 2 minutes before showing warning
  let warningShown = false;
  
  const checkHeartbeat = setInterval(() => {
    const now = Date.now();
    const timeSinceLastHeartbeat = now - lastHeartbeatReceived.value;
    
    if (timeSinceLastHeartbeat > heartbeatInterval) {
      debug(`No heartbeat received for ${timeSinceLastHeartbeat}ms, connection may be dead`);
      clearInterval(checkHeartbeat);
      socket.destroy();
    } else if (timeSinceLastHeartbeat > warningInterval && !warningShown) {
      // Show warning after 2 minutes of no heartbeat
      const lastHeartbeatDate = new Date(lastHeartbeatReceived.value).toISOString();
      errorWithTimestamp(`⚠️  No heartbeat received for ${Math.round(timeSinceLastHeartbeat/1000)}s (last: ${lastHeartbeatDate}) - server may be down`);
      warningShown = true;
    }
  }, heartbeatInterval);
  
  socket.on('close', () => {
    clearInterval(checkHeartbeat);
  });
  
  return { checkHeartbeat, warningShown: () => warningShown, resetWarning: () => { warningShown = false; } };
}

export async function connectAndServe(options, failureTracker = null) {
  debug('Starting tunnel service');

  // Normalize local host value early so it can be reused consistently
  const localHost = options.host || 'localhost';
  options.host = localHost;

  // Validate and use user-defined timeout or default to 30 seconds
  let timeoutSeconds = parseInt(options.timeout);
  if (isNaN(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 300) {
    if (options.timeout && options.timeout !== '30') {
      debug(`Invalid timeout value: ${options.timeout}, using default of 30 seconds`);
      errorWithTimestamp(`⚠️  Invalid timeout value: ${options.timeout}. Using default of 30 seconds. Valid range: 1-300 seconds.`);
    }
    timeoutSeconds = 30;
  }
  const TUNNEL_ESTABLISHMENT_TIMEOUT = timeoutSeconds * 1000;
  
  // Extract host from server option and ensure default port 1080
  const [serverHost, primaryPort] = options.server.split(':');
  const primaryServer = `${serverHost}:${primaryPort || '1080'}`;
  
  // Always use the primary server; secondary failover is removed
  let currentServer = primaryServer;
  
  const establishmentPromise = (async () => {
    // Connect to relay server (control channel)
    let ctrlConn = new Socket();
    const [connHost, connPort] = currentServer.split(':');

    try {
      const connectSpinner = createSpinner(`Connecting to ${connHost}:${connPort}`).start();
      debug(`Attempting TCP connection to ${connHost}:${connPort}`);
      const connectionStartTime = Date.now();
      
      await new Promise((resolve, reject) => {
        // Add connection timeout handler
        const connectTimeout = setTimeout(() => {
          debug(`Connection attempt timed out after ${Date.now() - connectionStartTime}ms`);
          ctrlConn.destroy();
          reject(new Error(`Connection timeout to ${connHost}:${connPort}`));
        }, 15000); // 15 seconds for initial TCP connection (increased for slow server)
        
        // Add exponential backoff for DNS resolution
        let dnsRetries = 0;
        const maxDnsRetries = 3;
        
        const attemptConnection = () => {
          // Enable TCP optimizations before connection
          ctrlConn.setNoDelay(true); // Disable Nagle's algorithm for faster small packets
          
          ctrlConn.connect(
            {
              host: connHost,
              port: parseInt(connPort),
              // TCP optimizations
              noDelay: true,
              keepAlive: true,
              keepAliveInitialDelay: 10000, // Start keepalive after 10s
              // Add TCP_QUICKACK equivalent - reduce ACK delays
              allowHalfOpen: false,
              // Enable TCP Fast Open if available
              hints: 0, // DNS resolution hints
            },
           
            () => {
              clearTimeout(connectTimeout);
              const connectionTime = Date.now() - connectionStartTime;
              debug(`Connected to relay server: ${currentServer} (took ${connectionTime}ms)`);
              connectSpinner.succeed(`Connected to ${connHost}:${connPort} (${connectionTime}ms)`);
              
              // Apply comprehensive TCP optimizations after connection
              optimizeSocket(ctrlConn);
              
              // Additional timeout handler
              ctrlConn.on('timeout', () => {
                debug('Control connection timed out');
                ctrlConn.destroy();
              });
              resolve();
            }
          );
        };
        
        ctrlConn.on('error', (err) => {
          if (err.code === 'ENOTFOUND' && dnsRetries < maxDnsRetries) {
            dnsRetries++;
            debug(`DNS resolution failed, retry ${dnsRetries}/${maxDnsRetries}`);
            setTimeout(() => {
              ctrlConn.destroy();
              ctrlConn = new Socket();
              attemptConnection();
            }, Math.pow(2, dnsRetries) * 1000); // Exponential backoff: 2s, 4s, 8s
          } else {
            clearTimeout(connectTimeout);
            debug(`Connection error after ${Date.now() - connectionStartTime}ms:`, err.message);
            reject(err);
          }
        });
        
        attemptConnection();
      });

      // Initialize secure channel (enabled by default, disabled with --insecure)
      let secureChannel = null;
      let secureEncoder = null;
      let decoder = null;

      if (!options.insecure) {
        debug('Secure mode enabled - initiating key exchange');

        // Create secure channel and generate keypair
        secureChannel = new SecureChannel();

        // Send secure handshake init using binary protocol
        // Binary format is used to bypass DPI proxies that block JSON on mobile networks
        const handshakeInit = new SecureHandshakeInit(secureChannel.getPublicKey());
        debug('Sending SECURE_INIT with public key (binary protocol)');
        const binaryHandshake = encodeBinaryHandshake(handshakeInit);
        ctrlConn.write(binaryHandshake);

        // Wait for server's handshake response (binary format)
        const handshakeDecoder = new BinaryHandshakeDecoder(ctrlConn);
        const handshakeResponse = await handshakeDecoder.decode();
        debug('Received handshake response:', handshakeResponse);

        if (handshakeResponse.command !== 'SECURE_ACK' || handshakeResponse.status !== 'OK') {
          throw new Error(`Secure handshake failed: ${handshakeResponse.error || 'Unknown error'}`);
        }

        // Derive shared secret from server's public key
        secureChannel.deriveSharedSecret(handshakeResponse.server_public_key);
        debug('Shared secret derived successfully');

        // Get any remaining buffer from handshake decoder (in case server sent more data)
        const remainingBuffer = handshakeDecoder.getRemainingBuffer();
        if (remainingBuffer.length > 0) {
          debug(`Passing ${remainingBuffer.length} bytes from handshake decoder to secure decoder`);
        }

        // Create secure encoder and decoder, passing remaining buffer
        secureEncoder = new SecureJSONEncoder(ctrlConn, secureChannel);
        decoder = new SecureJSONDecoder(ctrlConn, secureChannel, remainingBuffer);
      } else {
        // Create plaintext JSON decoder for control connection
        debug('Insecure mode - encryption disabled');
        decoder = createJSONDecoder(ctrlConn);
      }

      // Send tunnel request (encrypted if secure mode)
      const request = new TunnelRequest(
        'TUNNEL',
        options.port.toString(),
        options.domain,
        options.remote,
        options.token,
        options.type
      );

      debug('Sending tunnel request:', JSON.stringify(request));
      const establishSpinner = createSpinner('Establishing tunnel').start();
      const requestSentTime = Date.now();

      if (secureEncoder) {
        // Send encrypted tunnel request
        secureEncoder.send(request);
      } else {
        // Send plaintext tunnel request
        ctrlConn.write(JSON.stringify(request) + '\n');
      }

      // Wait for initial response
      debug('Waiting for server response...');
      const response = await decoder.decode();
      const responseTime = Date.now() - requestSentTime;
      debug(`Initial response received after ${responseTime}ms:`, response);

      if (response.status !== 'OK') {
        if (response.error && response.error.includes('Token')) {
          establishSpinner.fail('Authentication error');
          throw new Error(`Authentication error: ${response.error}`);
        }
        establishSpinner.fail('Server error');
        throw new Error(`Server error: ${response.error}`);
      }
      establishSpinner.succeed('Tunnel established');

      return { ctrlConn, decoder, response, secureChannel };
    } catch (err) {
      try { createSpinner().fail('Connection failed'); } catch {}
      if (ctrlConn) {
        ctrlConn.destroy();
      }
      throw err;
    }
  })();

  // Race between establishment and timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Tunnel establishment timeout - took more than ${timeoutSeconds} seconds`));
    }, TUNNEL_ESTABLISHMENT_TIMEOUT);
  });

  let ctrlConn, decoder, response, secureChannel;
  let healthMonitor = null;
  let isHealthMonitorConnLost = false;
  let tunnelHealthChecker = null;
  let tunnelHealthCheckTriggeredReconnect = false;

  try {
    const result = await Promise.race([establishmentPromise, timeoutPromise]);
    ctrlConn = result.ctrlConn;
    decoder = result.decoder;
    response = result.response;
    secureChannel = result.secureChannel;

    // Display tunnel URL (keep user-facing)
    const publicAddr = response.public_addr;
    if (options.type === 'http') {
      console.log('🚀 Tunnel active! Accessible via:', 'https://' + publicAddr.split(':')[0]);
      debug(`Connected to server: ${currentServer}`);
    } else {
      const connHost = currentServer.split(':')[0];
      const publicPort = publicAddr.split(':')[1];
      console.log('🚀 Tunnel active! Accessible via:', `tcp://${connHost}:${publicPort}`);
      debug(`Connected to server: ${currentServer}`);
    }

    // Initialize heartbeat monitoring
    const lastHeartbeatReceived = { value: Date.now() };
    const heartbeatMonitor = startHeartbeatMonitoring(ctrlConn, lastHeartbeatReceived);

    // Initialize health monitoring
    healthMonitor = new HealthMonitor();
    
    healthMonitor.start(
      // onConnectionLost callback
      () => {
        isHealthMonitorConnLost = true;
        debug('Health monitor detected server unreachable - forcing connection close');
        // Force close the control connection to trigger reconnection
        ctrlConn.destroy();
      },
      // onConnectionRestored callback
      () => {
        isHealthMonitorConnLost = false;
        debug('Health monitor detected server recovery');
        // La reconnexion sera gérée par la boucle de reconnexion automatique
      }
    );

    debug('Monitoring de santé du serveur activé (vérification toutes les 3s)');

    // Initialize tunnel health checker for local port and tunnel verification
    if (options.healthCheck !== false) {
      // Convert seconds to milliseconds (CLI passes seconds, default to 30 seconds)
      const healthCheckIntervalSeconds = parseInt(options.healthCheckInterval) || 30;
      const healthCheckInterval = healthCheckIntervalSeconds * 1000;
      
      // Parse public address for health checks
      // For HTTP: publicAddr is like "myapp.relais.dev:443" -> we need "myapp.relais.dev"
      // For TCP: publicAddr is like "tcp.relais.dev:12345" -> we need host and port separately
      const [publicHost, publicPort] = publicAddr.split(':');
      const tunnelTypeLabel = options.type === 'tcp' ? 'TCP' : 'HTTP';

      tunnelHealthChecker = new TunnelHealthChecker({
        localHost,
        localPort: parseInt(options.port),
        tunnelType: options.type || 'http',
        publicUrl: publicHost,
        publicPort: options.type === 'tcp' ? publicPort : null,
        relayServer: currentServer.split(':')[0],
        checkInterval: healthCheckInterval,
      });

      tunnelHealthChecker.start({
        onLocalPortDown: () => {
          errorWithTimestamp(`🔴 Le service local sur le port ${options.port} ne répond plus`);
        },
        onLocalPortRestored: () => {
          console.log(`✅ Le service local sur le port ${options.port} est de nouveau accessible`);
        },
        onTunnelDown: () => {
          debug(`Tunnel ${tunnelTypeLabel} détecté comme non fonctionnel`);
        },
        onTunnelRestored: () => {
          console.log(`✅ Le tunnel ${tunnelTypeLabel} fonctionne à nouveau`);
        },
        onReconnectNeeded: () => {
          debug('TunnelHealthChecker a déclenché une demande de reconnexion');
          tunnelHealthCheckTriggeredReconnect = true;
          // Force la fermeture de la connexion de contrôle pour déclencher la reconnexion
          if (ctrlConn) {
            ctrlConn.destroy();
          }
        },
      });

      debug(`Vérification de santé du tunnel ${tunnelTypeLabel} activée (intervalle: ${healthCheckIntervalSeconds}s)`);
    }

    // Main loop to receive new connections
    while (true) {
      try {
        const msg = await decoder.decode();
        // Only log non-heartbeat messages to avoid spam
        if (msg.command !== 'HEARTBEAT') {
          debug('Message received:', msg);
        }

        if (msg.command === 'NEWCONN') {
          // Handle new connection asynchronously.
          handleNewConnection(options, msg).catch((err) => {
            debug('Error handling new connection:', err);
          });
        } else if (msg.command === 'HEARTBEAT') {
          // Check if we were in warning state before updating timestamp
          const wasWarningShown = heartbeatMonitor.warningShown();
          
          // Update last heartbeat timestamp
          lastHeartbeatReceived.value = Date.now();
          
          // Show success message if we were in warning state
          if (wasWarningShown) {
            debug(`Server is alive again! Heartbeat resumed at ${new Date().toISOString()}`);
            heartbeatMonitor.resetWarning();
          }
        } else {
          debug('Unexpected message received:', msg);
        }
      } catch (err) {
        // If the connection is closed by the server, this is where we track it
        if (err.message === 'Connection closed by server') {
          // Don't record failure here - let the caller handle it
          throw err;
        }
        debug('Error reading message:', err);
        throw err; // Re-throw to trigger reconnection
      }
    }
  } catch (err) {
    debug('Error in connectAndServe:', err);
    
    // Check if the error was caused by tunnel health checker
    if (tunnelHealthCheckTriggeredReconnect) {
      throw new Error('Tunnel health check triggered reconnection');
    }
    
    // Check if the error was caused by health monitor
    if (isHealthMonitorConnLost) {
      throw new Error('Connection lost due to server health check failure');
    }
    
    // Check if it's a tunnel establishment timeout
    if (err.message.includes('Tunnel establishment timeout')) {
      // Pass through the original timeout message with the correct duration
      throw err;
    }
    
    throw err;
  } finally {
    // Stop tunnel health checker
    if (tunnelHealthChecker && typeof tunnelHealthChecker.stop === 'function') {
      tunnelHealthChecker.stop();
      debug('Tunnel health checker stopped');
    }

    // Stop health monitoring
    if (healthMonitor && typeof healthMonitor.stop === 'function') {
      healthMonitor.stop();
      debug('Health monitor stopped');
    }

    if (ctrlConn) {
      try {
        ctrlConn.destroy();
      } catch (err) {
        debug('Error closing control connection:', err);
      }
    }
  }
}

/**
 * Wraps connectAndServe() with an auto-reconnect loop.
 * If the control connection fails due to network issues,
 * it waits for 5 seconds before retrying.
 */
export async function runTunnel(options) {
  const failureTracker = new ConnectionFailureTracker();
  
  while (true) {
    try {
      // Agent mode: Never stop reconnecting for network errors, only for authentication issues
      await connectAndServe(options, failureTracker);
      
      // Reset failure tracker on successful connection
      failureTracker.reset();
      
    } catch (err) {
      // Handle health monitor connection loss specifically
      if (err.message.includes('Connection lost due to server health check failure')) {
        errorWithTimestamp('Connexion fermée par le monitoring de santé - Attente du rétablissement...');
        
        // Create a temporary health monitor to wait for server recovery
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
        // Immediate retry without backoff
        failureTracker.reset();
        continue;
      }
      
      // Determine error type and handle accordingly
      if (err.message.includes('Connection closed by server')) {
        failureTracker.recordServerClosure();
        const backoffDuration = failureTracker.getBackoffDuration();
        debug(`Server closed connection: ${err.message}; reconnecting in ${backoffDuration}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffDuration));
      } else if (failureTracker.isNetworkError(err)) {
        // Network errors - continue trying indefinitely with backoff
        failureTracker.recordNetworkError();
        const backoffDuration = failureTracker.getBackoffDuration();
        debug(`Network error: ${err.message}; reconnecting in ${backoffDuration}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffDuration));
      } else {
        // Other errors - treat as network errors for agent mode
        failureTracker.recordNetworkError();
        const backoffDuration = failureTracker.getBackoffDuration();
        debug(`Connection error: ${err.message}; reconnecting in ${backoffDuration}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffDuration));
      }
    }
  }
}
