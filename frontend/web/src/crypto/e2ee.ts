export type DeviceKeyBundle = {
  identityKeyPair: CryptoKeyPair;
};

export type ChatSession = {
  chatId: string;
  keyVersion: number;
  aesKey: CryptoKey;
};

export async function generateDeviceKeys(): Promise<DeviceKeyBundle> {
  const identityKeyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    ["deriveKey", "deriveBits"]
  );

  return { identityKeyPair };
}

export async function exportPublicKeyBase64(pubKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", pubKey);
  return toBase64(raw);
}

export async function importPeerPublicKeyBase64(publicKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    fromBase64(publicKeyB64),
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    false,
    []
  );
}

export async function createChatSession(params: {
  chatId: string;
  keyVersion: number;
  myPrivateKey: CryptoKey;
  peerPublicKey: CryptoKey;
}): Promise<ChatSession> {
  const bits = await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: params.peerPublicKey
    },
    params.myPrivateKey,
    256
  );

  // HKDF stage strengthens context binding to specific chat and key epoch.
  const hkdfKey = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  const info = new TextEncoder().encode(`${params.chatId}:${params.keyVersion}`);
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  return {
    chatId: params.chatId,
    keyVersion: params.keyVersion,
    aesKey
  };
}

export async function encryptMessage(session: ChatSession, plaintext: string): Promise<{
  ciphertextB64: string;
  nonceB64: string;
  keyVersion: number;
}> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    session.aesKey,
    encoded
  );

  return {
    ciphertextB64: toBase64(encrypted),
    nonceB64: toBase64(nonce.buffer),
    keyVersion: session.keyVersion
  };
}

export async function decryptMessage(
  session: ChatSession,
  payload: { ciphertextB64: string; nonceB64: string }
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(fromBase64(payload.nonceB64)) },
    session.aesKey,
    fromBase64(payload.ciphertextB64)
  );
  return new TextDecoder().decode(decrypted);
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
