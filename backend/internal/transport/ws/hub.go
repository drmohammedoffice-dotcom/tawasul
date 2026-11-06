package ws

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/go-redis/redis/v8"
)

type Hub struct {
	logger *slog.Logger
	redis  *redis.Client

	mu      sync.RWMutex
	clients map[string]map[*Client]struct{}
}

func NewHub(redisClient *redis.Client, logger *slog.Logger) *Hub {
	return &Hub{
		logger:  logger,
		redis:   redisClient,
		clients: map[string]map[*Client]struct{}{},
	}
}

func (h *Hub) RunSubscriptions(ctx context.Context, channels ...string) {
	pubsub := h.redis.Subscribe(ctx, channels...)
	go func() {
		defer pubsub.Close()
		for {
			msg, err := pubsub.ReceiveMessage(ctx)
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				h.logger.Error("redis subscription error", "error", err)
				continue
			}
			h.broadcastRaw(msg.Payload)
		}
	}()
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[c.UserID]; !ok {
		h.clients[c.UserID] = map[*Client]struct{}{}
	}
	h.clients[c.UserID][c] = struct{}{}
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if clients, ok := h.clients[c.UserID]; ok {
		delete(clients, c)
		if len(clients) == 0 {
			delete(h.clients, c.UserID)
		}
	}
}

func (h *Hub) SendToUser(userID string, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}
	h.sendRawToUser(userID, raw)
}

func (h *Hub) broadcastRaw(raw string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, sockets := range h.clients {
		for client := range sockets {
			select {
			case client.Send <- []byte(raw):
			default:
				// Drop if client is too slow; backpressure is handled by reconnect.
			}
		}
	}
}

func (h *Hub) sendRawToUser(userID string, raw []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients[userID] {
		select {
		case c.Send <- raw:
		default:
		}
	}
}
