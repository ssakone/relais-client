import { Socket } from 'net';
import { TunnelRequest } from '../models/messages.js';
import { setKeepAlive, setNoDelay, handleNewConnection } from '../network/connection.js';
import { debug, errorWithTimestamp } from '../utils/debug.js';
import { ConnectionFailureTracker } from '../utils/failure-tracker.js';
import { HealthMonitor } from '../utils/health-monitor.js';

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

        function cleanup() {
          socket.removeListener('data', onData);
          socket.removeListener('error', onError);
          socket.removeListener('end', onEnd);
        }

        socket.on('data', onData);
        socket.on('error', onError);
        socket.on('end', onEnd);
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
  
  // Create a timeout promise for the entire tunnel establishment process (30 seconds)
  const TUNNEL_ESTABLISHMENT_TIMEOUT = 30000; // 30 seconds
  
  const establishmentPromise = (async () => {
    // Connect to relay server (control channel)
    const ctrlConn = new Socket();
    const [serverHost, serverPort] = options.server.split(':');

    try {
      debug(`Attempting TCP connection to ${serverHost}:${serverPort}`);
      const connectionStartTime = Date.now();
      
      await new Promise((resolve, reject) => {
        // Add connection timeout handler
        const connectTimeout = setTimeout(() => {
          debug(`Connection attempt timed out after ${Date.now() - connectionStartTime}ms`);
          ctrlConn.destroy();
          reject(new Error(`Connection timeout to ${serverHost}:${serverPort}`));
        }, 15000); // 15 seconds for initial TCP connection (increased for slow server)
        
        // Enable TCP Fast Open if supported
        ctrlConn.setNoDelay(true); // Disable Nagle's algorithm for faster small packets
        
        ctrlConn.connect(
          {
            host: serverHost,
            port: parseInt(serverPort),
            // TCP optimizations
            noDelay: true,
            keepAlive: true,
            keepAliveInitialDelay: 10000, // Start keepalive after 10s
          },
         
          () => {
            clearTimeout(connectTimeout);
            const connectionTime = Date.now() - connectionStartTime;
            debug(`Connected to relay server: ${options.server} (took ${connectionTime}ms)`);
            
            // Apply additional TCP optimizations after connection
            setKeepAlive(ctrlConn);
            setNoDelay(ctrlConn);
            
            // Increased timeout to match server settings (120 seconds)
            ctrlConn.setTimeout(180000, () => { // 3 minutes for control connection
              debug('Control connection timed out');
              ctrlConn.destroy();
            });
            resolve();
          }
        );
        
        ctrlConn.on('error', (err) => {
          clearTimeout(connectTimeout);
          debug(`Connection error after ${Date.now() - connectionStartTime}ms:`, err.message);
          reject(err);
        });
      });

      // Send tunnel request in JSON
      const request = new TunnelRequest(
        'TUNNEL',
        options.port.toString(),
        options.domain,
        options.remote,
        options.token,
        options.type
      );

      debug('Sending tunnel request:', JSON.stringify(request));
      const requestSentTime = Date.now();
      ctrlConn.write(JSON.stringify(request) + '\n');

      // Create JSON decoder for control connection
      const decoder = createJSONDecoder(ctrlConn);

      // Wait for initial response
      debug('Waiting for server response...');
      const response = await decoder.decode();
      const responseTime = Date.now() - requestSentTime;
      debug(`Initial response received after ${responseTime}ms:`, response);

      if (response.status !== 'OK') {
        if (response.error && response.error.includes('Token')) {
          throw new Error(`Authentication error: ${response.error}`);
        }
        throw new Error(`Server error: ${response.error}`);
      }
      
      return { ctrlConn, decoder, response };
    } catch (err) {
      if (ctrlConn) {
        ctrlConn.destroy();
      }
      throw err;
    }
  })();

  // Race between establishment and timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('Tunnel establishment timeout - took more than 30 seconds'));
    }, TUNNEL_ESTABLISHMENT_TIMEOUT);
  });

  let ctrlConn, decoder, response;
  let healthMonitor = null;
  let isHealthMonitorConnLost = false;
  
  try {
    const result = await Promise.race([establishmentPromise, timeoutPromise]);
    ctrlConn = result.ctrlConn;
    decoder = result.decoder;
    response = result.response;

    // Display tunnel URL
    const publicAddr = response.public_addr;
    if (options.type === 'http') {
      console.log('🚀 Tunnel active! Accessible via:', 'https://' + publicAddr.split(':')[0]);
    } else {
      const serverHost = options.server.split(':')[0];
      const publicPort = publicAddr.split(':')[1];
      console.log('🚀 Tunnel active! Accessible via:', `tcp://${serverHost}:${publicPort}`);
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

    console.log('🏥 Monitoring de santé du serveur activé (vérification toutes les 5s)');

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
            console.log(`✅ Server is alive again! Heartbeat resumed at ${new Date().toISOString()}`);
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
