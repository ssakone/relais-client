import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';

import { connectAndServe } from '../src/tunnel/tunnel-service.js';

function readLine(socket, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    let buffer = '';

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for line`));
    }, timeoutMs);

    const onData = (chunk) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }

      const line = buffer.slice(0, newlineIndex);
      cleanup();
      resolve(line);
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const onClose = () => {
      cleanup();
      reject(new Error('Socket closed before a complete line was received'));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

test('connectAndServe acknowledges server heartbeats on the control channel', async () => {
  const server = createServer();
  const serverReady = once(server, 'listening');
  const heartbeatAck = new Promise((resolve, reject) => {
    server.once('connection', async (socket) => {
      try {
        const requestLine = await readLine(socket);
        const request = JSON.parse(requestLine);
        assert.equal(request.command, 'TUNNEL');

        socket.write(JSON.stringify({
          status: 'OK',
          public_addr: 'test.relais.dev:443',
        }) + '\n');

        socket.write(JSON.stringify({ command: 'HEARTBEAT' }) + '\n');

        const ackLine = await readLine(socket);
        resolve(JSON.parse(ackLine));
        socket.end();
      } catch (err) {
        reject(err);
      }
    });
  });

  server.listen(0, '127.0.0.1');
  await serverReady;

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  assert.ok(port, 'server did not expose a port');

  const clientResult = connectAndServe({
    server: `127.0.0.1:${port}`,
    host: '127.0.0.1',
    port: '3000',
    type: 'http',
    timeout: '5',
    insecure: true,
    healthCheck: false,
    serverHealthMonitor: false,
  }).catch((err) => err);

  const ack = await heartbeatAck;
  assert.deepEqual(ack, { command: 'HEARTBEAT_ACK' });

  const result = await clientResult;
  assert.equal(result.message, 'Connection closed by server');

  server.close();
});
