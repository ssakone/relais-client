import { Socket } from 'net';
import { optimizeSocket } from './connection.js';
import { debug } from '../utils/debug.js';

/**
 * Simple connection pool for reusing data connections
 */
export class ConnectionPool {
  constructor(maxSize = 10) {
    this.maxSize = maxSize;
    this.pool = new Map(); // key: "host:port", value: Array of sockets
    this.stats = {
      created: 0,
      reused: 0,
      destroyed: 0
    };
  }

  /**
   * Get a connection from the pool or create a new one
   * @param {string} host 
   * @param {number} port 
   * @param {number} timeout - Connection timeout in ms
   * @returns {Promise<Socket>}
   */
  async getConnection(host, port, timeout = 10000) {
    const key = `${host}:${port}`;
    const connections = this.pool.get(key) || [];
    
    // Try to find a healthy connection
    while (connections.length > 0) {
      const socket = connections.pop();
      if (socket && !socket.destroyed && socket.readable && socket.writable) {
        debug(`Reusing connection from pool for ${key}`);
        this.stats.reused++;
        return socket;
      }
      // Socket is dead, clean it up
      this.stats.destroyed++;
      if (socket && !socket.destroyed) {
        socket.destroy();
      }
    }
    
    // No healthy connection found, create a new one
    debug(`Creating new connection for ${key}`);
    const socket = new Socket();
    
    return new Promise((resolve, reject) => {
      const connectTimeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection timeout to ${key}`));
      }, timeout);
      
      socket.connect({ host, port }, () => {
        clearTimeout(connectTimeout);
        optimizeSocket(socket);
        this.stats.created++;
        
        // Set up cleanup on socket close
        socket.once('close', () => {
          this.removeFromPool(key, socket);
        });
        
        resolve(socket);
      });
      
      socket.once('error', (err) => {
        clearTimeout(connectTimeout);
        reject(err);
      });
    });
  }
  
  /**
   * Return a connection to the pool for reuse
   * @param {string} host 
   * @param {number} port 
   * @param {Socket} socket 
   */
  returnConnection(host, port, socket) {
    if (!socket || socket.destroyed || !socket.readable || !socket.writable) {
      // Don't pool dead connections
      if (socket && !socket.destroyed) {
        socket.destroy();
      }
      return;
    }
    
    const key = `${host}:${port}`;
    const connections = this.pool.get(key) || [];
    
    if (connections.length < this.maxSize) {
      debug(`Returning connection to pool for ${key}`);
      connections.push(socket);
      this.pool.set(key, connections);
    } else {
      // Pool is full, destroy the connection
      debug(`Pool full for ${key}, destroying connection`);
      socket.destroy();
      this.stats.destroyed++;
    }
  }
  
  /**
   * Remove a socket from the pool
   * @param {string} key 
   * @param {Socket} socket 
   */
  removeFromPool(key, socket) {
    const connections = this.pool.get(key);
    if (connections) {
      const index = connections.indexOf(socket);
      if (index !== -1) {
        connections.splice(index, 1);
        if (connections.length === 0) {
          this.pool.delete(key);
        }
      }
    }
  }
  
  /**
   * Clear all connections in the pool
   */
  clear() {
    for (const [key, connections] of this.pool.entries()) {
      for (const socket of connections) {
        if (socket && !socket.destroyed) {
          socket.destroy();
          this.stats.destroyed++;
        }
      }
    }
    this.pool.clear();
  }
  
  /**
   * Get pool statistics
   */
  getStats() {
    const poolSizes = {};
    for (const [key, connections] of this.pool.entries()) {
      poolSizes[key] = connections.length;
    }
    
    return {
      ...this.stats,
      poolSizes,
      totalPooled: Object.values(poolSizes).reduce((a, b) => a + b, 0)
    };
  }
}

// Global connection pool instance
export const globalConnectionPool = new ConnectionPool();