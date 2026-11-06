import { FormEvent, useEffect, useMemo, useState } from "react";
import { register, sendEncryptedMessage, wsUrl } from "./api";
import {
  ChatSession,
  createChatSession,
  decryptMessage,
  encryptMessage,
  generateDeviceKeys
} from "./crypto/e2ee";
import "./styles.css";

type UiMessage = {
  id: string;
  direction: "in" | "out";
  preview: string;
  createdAt: string;
};

const CHAT_ID = "00000000-0000-0000-0000-000000000001";

export default function App() {
  const [token, setToken] = useState<string>("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [status, setStatus] = useState("Initializing...");

  const deviceId = useMemo(() => `web-${crypto.randomUUID()}`, []);

  useEffect(() => {
    let socket: WebSocket | null = null;

    const init = async () => {
      try {
        const keys = await generateDeviceKeys();
        const peer = await generateDeviceKeys();
        const chatSession = await createChatSession({
          chatId: CHAT_ID,
          keyVersion: 1,
          myPrivateKey: keys.identityKeyPair.privateKey,
          peerPublicKey: peer.identityKeyPair.publicKey
        });
        setSession(chatSession);

        const auth = await register({
          username: `user_${Math.floor(Math.random() * 100000)}`,
          password: "VeryStrongPass123!",
          deviceId
        });
        setToken(auth.accessToken);

        socket = new WebSocket(wsUrl(auth.accessToken));
        socket.onopen = () => setStatus("Connected");
        socket.onclose = () => setStatus("Disconnected");
        socket.onerror = () => setStatus("Socket Error");
        socket.onmessage = async (event) => {
          const incoming = JSON.parse(String(event.data)) as {
            id?: string;
            ciphertextB64?: string;
            nonceB64?: string;
            createdAt?: string;
          };
          if (!incoming.ciphertextB64 || !incoming.nonceB64 || !chatSession) {
            return;
          }
          try {
            const plain = await decryptMessage(chatSession, {
              ciphertextB64: incoming.ciphertextB64,
              nonceB64: incoming.nonceB64
            });
            setMessages((prev) => [
              ...prev,
              {
                id: incoming.id ?? crypto.randomUUID(),
                direction: "in",
                preview: plain,
                createdAt: incoming.createdAt ?? new Date().toISOString()
              }
            ]);
          } catch {
            // Ignore messages for unknown key epochs.
          }
        };
      } catch (err) {
        console.error(err);
        setStatus("Initialization failed");
      }
    };

    void init();
    return () => {
      if (socket) socket.close();
    };
  }, [deviceId]);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !token || !session) {
      return;
    }
    const plaintext = input.trim();
    const encrypted = await encryptMessage(session, plaintext);
    const clientMsgId = crypto.randomUUID();
    await sendEncryptedMessage(token, {
      chatId: CHAT_ID,
      ciphertextB64: encrypted.ciphertextB64,
      nonceB64: encrypted.nonceB64,
      keyVersion: encrypted.keyVersion,
      messageType: "text",
      clientMsgId
    });
    setMessages((prev) => [
      ...prev,
      {
        id: clientMsgId,
        direction: "out",
        preview: plaintext,
        createdAt: new Date().toISOString()
      }
    ]);
    setInput("");
  };

  return (
    <main className="layout">
      <aside className="sidebar">
        <h1>SecureMesh</h1>
        <p className="muted">E2EE chat prototype</p>
        <div className="status">Status: {status}</div>
      </aside>
      <section className="chat">
        <div className="messages">
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.direction}`}>
              <p>{m.preview}</p>
              <small>{new Date(m.createdAt).toLocaleTimeString()}</small>
            </div>
          ))}
        </div>
        <form className="composer" onSubmit={handleSend}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type encrypted message..."
          />
          <button type="submit">Send</button>
        </form>
      </section>
    </main>
  );
}
