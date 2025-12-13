import crypto from 'crypto';

/**
 * SecureChannel provides end-to-end encryption for tunnel communications
 * using ECDH P-256 for key exchange and AES-256-GCM for symmetric encryption.
 */
export class SecureChannel {
  constructor() {
    // Generate ECDH P-256 keypair
    this.ecdh = crypto.createECDH('prime256v1');
    this.ecdh.generateKeys();
    this.sharedSecret = null;
    this.aesKey = null;
  }

  /**
   * Get the public key in base64 format for exchange
   * @returns {string} Base64-encoded public key
   */
  getPublicKey() {
    return this.ecdh.getPublicKey('base64');
  }

  /**
   * Derive the shared secret and AES key from the server's public key
   * @param {string} serverPublicKeyBase64 - Server's public key in base64
   */
  deriveSharedSecret(serverPublicKeyBase64) {
    const serverPubKey = Buffer.from(serverPublicKeyBase64, 'base64');
    this.sharedSecret = this.ecdh.computeSecret(serverPubKey);

    // Derive AES-256 key using HKDF
    this.aesKey = crypto.hkdfSync(
      'sha256',
      this.sharedSecret,
      Buffer.from('relais-tunnel-v1'), // salt
      Buffer.from('aes-256-gcm-key'),  // info
      32 // 256 bits
    );
  }

  /**
   * Encrypt a message using AES-256-GCM
   * @param {string} plaintext - The message to encrypt
   * @returns {Buffer} Encrypted message with format: [4-byte length][12-byte nonce][ciphertext][16-byte auth tag]
   */
  encrypt(plaintext) {
    if (!this.aesKey) {
      throw new Error('Shared secret not derived. Call deriveSharedSecret() first.');
    }

    // Generate random 96-bit nonce
    const nonce = crypto.randomBytes(12);

    // Create cipher and encrypt
    const cipher = crypto.createCipheriv('aes-256-gcm', this.aesKey, nonce);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    // Build message: [4-byte length][12-byte nonce][ciphertext][16-byte auth tag]
    const totalLen = 12 + encrypted.length + 16;
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(totalLen);

    return Buffer.concat([lenBuf, nonce, encrypted, authTag]);
  }

  /**
   * Decrypt a message using AES-256-GCM
   * @param {Buffer} encryptedData - Encrypted data (without length prefix): [12-byte nonce][ciphertext][16-byte auth tag]
   * @returns {string} Decrypted plaintext
   */
  decrypt(encryptedData) {
    if (!this.aesKey) {
      throw new Error('Shared secret not derived. Call deriveSharedSecret() first.');
    }

    if (encryptedData.length < 12 + 16) {
      throw new Error('Encrypted data too short');
    }

    // Extract components
    const nonce = encryptedData.slice(0, 12);
    const authTag = encryptedData.slice(-16);
    const ciphertext = encryptedData.slice(12, -16);

    // Create decipher and decrypt
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.aesKey, nonce);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * Check if the secure channel is established
   * @returns {boolean}
   */
  isEstablished() {
    return this.aesKey !== null;
  }
}

/**
 * SecureJSONEncoder wraps a socket to send encrypted JSON messages
 * Uses binary encoding (base64) to bypass DPI on mobile networks
 */
export class SecureJSONEncoder {
  constructor(socket, secureChannel) {
    this.socket = socket;
    this.secureChannel = secureChannel;
  }

  /**
   * Send an encrypted JSON message using binary protocol (base64 encoded for DPI bypass)
   * Format: [0x00 magic][4-byte length BE][base64(encrypted data)]
   * @param {Object} message - The message object to encrypt and send
   */
  send(message) {
    const jsonStr = JSON.stringify(message);
    // encrypt() returns [4-byte length][12-byte nonce][ciphertext]
    // We need just the encrypted part (nonce + ciphertext) for base64 encoding
    const fullEncrypted = this.secureChannel.encrypt(jsonStr);
    // Skip the 4-byte length prefix, we'll add our own binary protocol header
    const encryptedData = fullEncrypted.slice(4);

    // Base64 encode the encrypted data
    const b64Data = encryptedData.toString('base64');

    // Build binary protocol message: [0x00][4-byte length][base64]
    const msg = Buffer.alloc(1 + 4 + b64Data.length);
    msg[0] = BINARY_PROTOCOL_MAGIC;
    msg.writeUInt32BE(b64Data.length, 1);
    msg.write(b64Data, 5);

    this.socket.write(msg);
  }
}

/**
 * SecureJSONDecoder wraps a socket to receive encrypted JSON messages
 * Uses binary protocol (base64) to bypass DPI on mobile networks
 */
export class SecureJSONDecoder {
  constructor(socket, secureChannel, initialBuffer = null) {
    this.socket = socket;
    this.secureChannel = secureChannel;
    this.buffer = initialBuffer && initialBuffer.length > 0 ? initialBuffer : Buffer.alloc(0);
  }

  /**
   * Read and decrypt the next JSON message
   * Binary protocol format: [0x00 magic][4-byte length BE][base64(encrypted data)]
   * @returns {Promise<Object>} The decrypted message object
   */
  decode() {
    return new Promise((resolve, reject) => {
      const tryParse = () => {
        // Binary protocol: [0x00][4-byte length][base64]
        // Need at least 5 bytes for magic + length
        if (this.buffer.length < 5) {
          return false;
        }

        // Verify magic byte
        if (this.buffer[0] !== BINARY_PROTOCOL_MAGIC) {
          reject(new Error('Invalid magic byte in binary message'));
          return true;
        }

        const b64Len = this.buffer.readUInt32BE(1);

        // Sanity check on message length (~1.4MB base64 decodes to ~1MB)
        if (b64Len > 1400 * 1024) {
          reject(new Error('Message too large'));
          return true;
        }

        // Check if we have the complete message
        if (this.buffer.length < 5 + b64Len) {
          return false;
        }

        // Extract base64 data
        const b64Data = this.buffer.slice(5, 5 + b64Len).toString();
        this.buffer = this.buffer.slice(5 + b64Len);

        try {
          // Decode base64 to get encrypted data (nonce + ciphertext)
          const encryptedData = Buffer.from(b64Data, 'base64');
          const plaintext = this.secureChannel.decrypt(encryptedData);
          const message = JSON.parse(plaintext);
          resolve(message);
        } catch (err) {
          reject(new Error('Decryption or parsing error: ' + err.message));
        }
        return true;
      };

      // Try to parse from existing buffer
      if (tryParse()) {
        return;
      }

      const onData = (data) => {
        this.buffer = Buffer.concat([this.buffer, data]);
        if (tryParse()) {
          cleanup();
        }
      };

      const onError = (err) => {
        cleanup();
        reject(err);
      };

      const onEnd = () => {
        cleanup();
        reject(new Error('Connection closed by server'));
      };

      const onClose = () => {
        cleanup();
        reject(new Error('Connection closed by server'));
      };

      const cleanup = () => {
        this.socket.removeListener('data', onData);
        this.socket.removeListener('error', onError);
        this.socket.removeListener('end', onEnd);
        this.socket.removeListener('close', onClose);
      };

      this.socket.on('data', onData);
      this.socket.on('error', onError);
      this.socket.on('end', onEnd);
      this.socket.on('close', onClose);
    });
  }
}

/**
 * Binary protocol magic byte - identifies binary-encoded handshake messages
 */
export const BINARY_PROTOCOL_MAGIC = 0x00;

/**
 * Encode a JSON object as a binary handshake message
 * Format: [1 byte: 0x00][4 bytes: length BE][base64(JSON)]
 * @param {Object} jsonObj - The JSON object to encode
 * @returns {Buffer} The binary-encoded message
 */
export function encodeBinaryHandshake(jsonObj) {
  const jsonStr = JSON.stringify(jsonObj);
  const base64 = Buffer.from(jsonStr).toString('base64');

  // Build message: [0x00][4 bytes len][base64]
  const msg = Buffer.alloc(1 + 4 + base64.length);
  msg[0] = BINARY_PROTOCOL_MAGIC;
  msg.writeUInt32BE(base64.length, 1);
  msg.write(base64, 5);

  return msg;
}

/**
 * Decode a binary handshake message to JSON
 * Reads from a buffer that starts with the magic byte
 * @param {Buffer} buffer - The buffer containing the binary message
 * @returns {{message: Object, bytesConsumed: number}} The decoded message and bytes consumed
 */
export function decodeBinaryHandshake(buffer) {
  if (buffer.length < 5) {
    throw new Error('Buffer too short for binary handshake');
  }

  if (buffer[0] !== BINARY_PROTOCOL_MAGIC) {
    throw new Error('Invalid magic byte for binary handshake');
  }

  const length = buffer.readUInt32BE(1);

  if (length > 64 * 1024) {
    throw new Error('Handshake message too large');
  }

  if (buffer.length < 5 + length) {
    throw new Error('Incomplete binary handshake message');
  }

  const base64Payload = buffer.slice(5, 5 + length).toString();
  const jsonStr = Buffer.from(base64Payload, 'base64').toString('utf8');
  const message = JSON.parse(jsonStr);

  return {
    message,
    bytesConsumed: 5 + length
  };
}

/**
 * BinaryHandshakeDecoder reads binary handshake messages from a socket
 */
export class BinaryHandshakeDecoder {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Get remaining buffer data (for passing to next decoder)
   * @returns {Buffer} The remaining unprocessed data
   */
  getRemainingBuffer() {
    return this.buffer;
  }

  /**
   * Read and decode the next binary handshake message
   * @returns {Promise<Object>} The decoded JSON message
   */
  decode() {
    return new Promise((resolve, reject) => {
      const tryParse = () => {
        // Need at least 5 bytes for magic + length
        if (this.buffer.length < 5) {
          return false;
        }

        // Verify magic byte
        if (this.buffer[0] !== BINARY_PROTOCOL_MAGIC) {
          reject(new Error('Invalid magic byte in binary handshake'));
          return true;
        }

        const length = this.buffer.readUInt32BE(1);

        // Sanity check
        if (length > 64 * 1024) {
          reject(new Error('Handshake message too large'));
          return true;
        }

        // Check if we have the complete message
        if (this.buffer.length < 5 + length) {
          return false;
        }

        // Extract and decode
        const base64Payload = this.buffer.slice(5, 5 + length).toString();
        this.buffer = this.buffer.slice(5 + length);

        try {
          const jsonStr = Buffer.from(base64Payload, 'base64').toString('utf8');
          const message = JSON.parse(jsonStr);
          resolve(message);
        } catch (err) {
          reject(new Error('Error decoding binary handshake: ' + err.message));
        }
        return true;
      };

      // Try to parse from existing buffer
      if (tryParse()) {
        return;
      }

      const onData = (data) => {
        this.buffer = Buffer.concat([this.buffer, data]);
        if (tryParse()) {
          cleanup();
        }
      };

      const onError = (err) => {
        cleanup();
        reject(err);
      };

      const onEnd = () => {
        cleanup();
        reject(new Error('Connection closed by server'));
      };

      const onClose = () => {
        cleanup();
        reject(new Error('Connection closed by server'));
      };

      const cleanup = () => {
        this.socket.removeListener('data', onData);
        this.socket.removeListener('error', onError);
        this.socket.removeListener('end', onEnd);
        this.socket.removeListener('close', onClose);
      };

      this.socket.on('data', onData);
      this.socket.on('error', onError);
      this.socket.on('end', onEnd);
      this.socket.on('close', onClose);
    });
  }
}
