import { Socket } from 'net';
import { debug } from '../utils/debug.js';

export function setKeepAlive(socket) {
  socket.setKeepAlive(true, 30000); // 30 seconds like in Go client
}

export function setNoDelay(socket) {
  socket.setNoDelay(true);
}

// Copy data from one socket to another using events
function copyData(dst, src) {
  return new Promise((resolve, reject) => {
    src.on('data', (chunk) => {
      const canContinue = dst.write(chunk);
      if (!canContinue) {
        src.pause();
        dst.once('drain', () => {
          src.resume();
        });
      }
    });

    src.on('end', () => {
      debug('Source stream ended');
      resolve();
    });

    src.on('error', (err) => {
      debug('Source stream error:', err);
      reject(err);
    });

    dst.on('error', (err) => {
      debug('Destination stream error:', err);
      reject(err);
    });
  });
}

export async function handleNewConnection(options, response) {
  debug('Processing new connection, ID:', response.conn_id);
  
  // 1. Establish data connection
  const dataConn = new Socket();
  const [dataHost, dataPort] = response.data_addr.split(':');
  
  try {
    // Connect to data port
    await new Promise((resolve, reject) => {
      debug(`Attempting to connect to data port: ${dataHost}:${dataPort}`);
      dataConn.connect({
        host: dataHost,
        port: parseInt(dataPort),
      }, () => {
        debug('Connected to data port:', response.data_addr);
        setKeepAlive(dataConn);
        setNoDelay(dataConn);
        resolve();
      });
      
      dataConn.on('error', (err) => {
        debug('Data connection error:', err);
        reject(err);
      });
    });

    // 2. Establish local connection AFTER connecting to data port
    const localConn = new Socket();
    await new Promise((resolve, reject) => {
      debug(`Attempting to connect to local service: ${options.host}:${options.port}`);
      
      localConn.connect({
        host: options.host,
        port: parseInt(options.port),
      }, () => {
        debug('Connected to local service:', `${options.host}:${options.port}`);
        setKeepAlive(localConn);
        setNoDelay(localConn);
        resolve();
      });
      
      localConn.on('error', (err) => {
        debug('Local connection error:', err);
        dataConn.destroy();
        reject(err);
      });
    });

    // 3. Handle bidirectional data transfer
    debug('Starting bidirectional transfer');

    // Simulate Go's CloseWrite() behavior by only closing the write stream
    function closeWrite(socket) {
      debug('Closing write stream');
      // Use end() to properly close the write stream
      socket.end(() => {
        debug('Write stream closed');
      });
    }

    let dataConnClosed = false;
    let localConnClosed = false;

    // First transfer: localConn -> dataConn
    copyData(dataConn, localConn).then(() => {
      debug('Transfer localConn -> dataConn completed');
      if (!dataConnClosed) {
        dataConnClosed = true;
        closeWrite(dataConn);
      }
    }).catch(err => {
      debug('Error during transfer localConn -> dataConn:', err);
      dataConn.destroy();
      localConn.destroy();
    });

    // Second transfer: dataConn -> localConn
    copyData(localConn, dataConn).then(() => {
      debug('Transfer dataConn -> localConn completed');
      if (!localConnClosed) {
        localConnClosed = true;
        closeWrite(localConn);
      }
    }).catch(err => {
      debug('Error during transfer dataConn -> localConn:', err);
      dataConn.destroy();
      localConn.destroy();
    });

    // Wait for both sockets to close naturally
    await Promise.all([
      new Promise(resolve => dataConn.on('end', resolve)),
      new Promise(resolve => localConn.on('end', resolve))
    ]);

    debug('Both connections have ended');
    dataConn.destroy();
    localConn.destroy();

  } catch (err) {
    debug('Error handling new connection:', err);
    if (dataConn) dataConn.destroy();
    throw err;
  }
}
