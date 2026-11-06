const NONCE_BYTES = 12; // AES-GCM recommended IV size.

export type E2EEPublicKeyBundle = {
  keyId: string;
  publicKeyBase64: string;
};

export type E2EEKeyPair = {
  keyId: string;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
};

export type EncryptedMessagePayload = {
  algorithm: 'AES-256-GCM';
  keyId: string;
  ciphertext: string;
  nonce: string;
  timestamp: string;
};

/**
 * Generate an ECDH keypair for client devices.
 * The private key must remain on the client device only.
 */
export async function generateECDHKeyPair(): Promise<E2EEKeyPair> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveKey']
  );

  return {
    keyId: crypto.randomUUID(),
    publicKey: pair.publicKey,
    privateKey: pair.privateKey
  };
}

export async function exportPublicKeyBundle(keyPair: E2EEKeyPair): Promise<E2EEPublicKeyBundle> {
  const raw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  return {
    keyId: keyPair.keyId,
    publicKeyBase64: toBase64(raw)
  };
}

export async function importECDHPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    fromBase64(publicKeyBase64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
}

/**
 * ECDH key exchange simulation:
 * Derives a per-chat AES-256-GCM session key from local private key + peer public key.
 */
export async function deriveChatSessionKey(params: {
  chatId: string;
  localPrivateKey: CryptoKey;
  peerPublicKey: CryptoKey;
}): Promise<CryptoKey> {
  const sharedSecretBits = await crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: params.peerPublicKey
    },
    params.localPrivateKey,
    256
  );

  const hkdfInput = await crypto.subtle.importKey('raw', sharedSecretBits, 'HKDF', false, [
    'deriveKey'
  ]);

  // Bind key derivation to chat scope so each chat has its own session key.
  const info = new TextEncoder().encode(`chat:${params.chatId}`);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info
    },
    hkdfInput,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Server should only receive this encrypted payload.
 */
export async function encryptMessage(args: {
  plaintext: string;
  sessionKey: CryptoKey;
  keyId: string;
}): Promise<EncryptedMessagePayload> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const encoded = new TextEncoder().encode(args.plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce
    },
    args.sessionKey,
    encoded
  );

  return {
    algorithm: 'AES-256-GCM',
    keyId: args.keyId,
    ciphertext: toBase64(ciphertext),
    nonce: toBase64(nonce.buffer),
    timestamp: new Date().toISOString()
  };
}

export async function decryptMessage(args: {
  payload: EncryptedMessagePayload;
  sessionKey: CryptoKey;
}): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(fromBase64(args.payload.nonce))
    },
    args.sessionKey,
    fromBase64(args.payload.ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(binary);
  }

  const maybeBuffer = (globalThis as { Buffer?: { from(v: string, e: string): { toString(x: string): string } } }).Buffer;
  if (!maybeBuffer) {
    throw new Error('No base64 encoder available in current runtime');
  }
  return maybeBuffer.from(binary, 'binary').toString('base64');
}

function fromBase64(value: string): ArrayBuffer {
  const binary =
    typeof globalThis.atob === 'function'
      ? globalThis.atob(value)
      : decodeWithNodeBuffer(value);

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function decodeWithNodeBuffer(value: string): string {
  const maybeBuffer = (globalThis as { Buffer?: { from(v: string, e: string): { toString(x: string): string } } }).Buffer;
  if (!maybeBuffer) {
    throw new Error('No base64 decoder available in current runtime');
  }
  return maybeBuffer.from(value, 'base64').toString('binary');
}
