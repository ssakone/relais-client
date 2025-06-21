import { Socket } from 'net';
import { TunnelRequest } from '../models/messages.js';
import { setKeepAlive, setNoDelay, handleNewConnection } from '../network/connection.js';
import { debug } from '../utils/debug.js';
import { ConnectionFailureTracker } from '../utils/failure-tracker.js';

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
              debug('JSON message received:', message);
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
  
  const checkHeartbeat = setInterval(() => {
    const now = Date.now();
    const timeSinceLastHeartbeat = now - lastHeartbeatReceived.value;
    
    if (timeSinceLastHeartbeat > heartbeatInterval) {
      debug(`No heartbeat received for ${timeSinceLastHeartbeat}ms, connection may be dead`);
      clearInterval(checkHeartbeat);
      socket.destroy();
    }
  }, heartbeatInterval);
  
  socket.on('close', () => {
    clearInterval(checkHeartbeat);
  });
  
  return checkHeartbeat;
}

export async function connectAndServe(options, failureTracker = null) {
  debug('Starting tunnel service');
  
  // Connect to relay server (control channel)
  const ctrlConn = new Socket();
  const [serverHost, serverPort] = options.server.split(':');

  try {
    await new Promise((resolve, reject) => {
      ctrlConn.connect(
        {
          host: serverHost,
          port: parseInt(serverPort),
          // proxy: {
          //   host: '162.250.189.217',  // your SOCKS5 proxy host
          //   port: 4080,         // your SOCKS5 proxy port
          //   type: 5             // SOCKS version
          // },
        },
       
        () => {
          debug('Connected to relay server:', options.server);
          setKeepAlive(ctrlConn);
          // Increased timeout to match server settings (120 seconds)
          ctrlConn.setTimeout(180000, () => { // 3 minutes for control connection
            debug('Control connection timed out');
            ctrlConn.destroy();
          });
          resolve();
        }
      );
      
      ctrlConn.on('error', reject);
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
    ctrlConn.write(JSON.stringify(request) + '\n');

    // Create JSON decoder for control connection
    const decoder = createJSONDecoder(ctrlConn);

    // Wait for initial response
    const response = await decoder.decode();
    debug('Initial response received:', response);

    if (response.status !== 'OK') {
      if (response.error && response.error.includes('Token')) {
        throw new Error(`Authentication error: ${response.error}`);
      }
      throw new Error(`Server error: ${response.error}`);
    }

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
    const heartbeatChecker = startHeartbeatMonitoring(ctrlConn, lastHeartbeatReceived);

    // Main loop to receive new connections
    while (true) {
      try {
        const msg = await decoder.decode();
        debug('Message received:', msg);

        if (msg.command === 'NEWCONN') {
          // Handle new connection asynchronously.
          handleNewConnection(options, msg).catch((err) => {
            debug('Error handling new connection:', err);
          });
        } else if (msg.command === 'HEARTBEAT') {
          // Update last heartbeat timestamp
          lastHeartbeatReceived.value = Date.now();
          debug('Heartbeat received, connection is alive');
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
    throw err;
  } finally {
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
