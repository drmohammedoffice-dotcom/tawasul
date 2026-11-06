export type AuthTokens = {
  userId: string;
  accessToken: string;
  refreshToken: string;
};

export type EncryptedEnvelope = {
  chatId: string;
  ciphertextB64: string;
  nonceB64: string;
  keyVersion: number;
  messageType: "text";
  clientMsgId: string;
};

const API_BASE = "http://localhost:8080";

export async function register(input: {
  username: string;
  password: string;
  deviceId: string;
}): Promise<AuthTokens> {
  const res = await fetch(`${API_BASE}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!res.ok) {
    throw new Error("register failed");
  }
  return res.json();
}

export async function sendEncryptedMessage(accessToken: string, payload: EncryptedEnvelope): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error("send failed");
  }
}

export function wsUrl(accessToken: string): string {
  const url = new URL("ws://localhost:8080/ws");
  // Gateway uses bearer token, so browsers append via subprotocol workaround or query in production.
  // For demo simplicity we pass through query and mirror it as Authorization at proxy edge.
  url.searchParams.set("accessToken", accessToken);
  return url.toString();
}
