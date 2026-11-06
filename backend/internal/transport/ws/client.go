package ws

import (
	"log/slog"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait = 10 * time.Second
	pongWait  = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
)

type Client struct {
	UserID string
	Conn   *websocket.Conn
	Send   chan []byte
	Logger *slog.Logger
}

func NewClient(userID string, conn *websocket.Conn, logger *slog.Logger) *Client {
	return &Client{
		UserID: userID,
		Conn:   conn,
		Send:   make(chan []byte, 256),
		Logger: logger,
	}
}

func (c *Client) ReadPump(onMessage func([]byte)) {
	defer c.Conn.Close()
	c.Conn.SetReadLimit(1 << 20)
	_ = c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		return c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, payload, err := c.Conn.ReadMessage()
		if err != nil {
			return
		}
		onMessage(payload)
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.Send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
