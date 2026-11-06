package http

import (
	"context"
	"net/http"
	"strings"
	"time"

	"securemesh/backend/internal/auth"
	"securemesh/backend/internal/chat"
	"securemesh/backend/internal/transport/ws"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

type RouterDeps struct {
	AuthService  *auth.Service
	TokenManager *auth.TokenManager
	ChatService  *chat.Service
	Hub          *ws.Hub
}

func NewRouter(deps RouterDeps) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	r.POST("/v1/auth/register", func(c *gin.Context) {
		var req struct {
			Username string `json:"username" binding:"required,min=3,max=32"`
			Password string `json:"password" binding:"required,min=8,max=128"`
			DeviceID string `json:"deviceId" binding:"required,min=8,max=64"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		result, err := deps.AuthService.Register(c.Request.Context(), req.Username, req.Password, req.DeviceID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, result)
	})

	r.POST("/v1/auth/login", func(c *gin.Context) {
		var req struct {
			Username string `json:"username" binding:"required"`
			Password string `json:"password" binding:"required"`
			DeviceID string `json:"deviceId" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		result, err := deps.AuthService.Login(c.Request.Context(), req.Username, req.Password, req.DeviceID)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
			return
		}
		c.JSON(http.StatusOK, result)
	})

	r.POST("/v1/auth/refresh", func(c *gin.Context) {
		var req struct {
			RefreshToken string `json:"refreshToken" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		result, err := deps.AuthService.Refresh(c.Request.Context(), req.RefreshToken)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
			return
		}
		c.JSON(http.StatusOK, result)
	})

	authz := r.Group("/v1", authMiddleware(deps.TokenManager))
	authz.POST("/chats", func(c *gin.Context) {
		userID := c.GetString("userID")
		var req struct {
			Type    string   `json:"type" binding:"required,oneof=direct group channel"`
			Title   string   `json:"title"`
			Members []string `json:"members"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		created, err := deps.ChatService.CreateChat(c.Request.Context(), req.Type, req.Title, userID, req.Members)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, created)
	})

	authz.POST("/messages", func(c *gin.Context) {
		userID := c.GetString("userID")
		var req chat.MessageEnvelope
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		req.SenderUserID = userID
		msg, err := deps.ChatService.SendMessage(c.Request.Context(), req)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, msg)
	})

	authz.POST("/receipts", func(c *gin.Context) {
		userID := c.GetString("userID")
		var req chat.DeliveryReceipt
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		req.UserID = userID
		req.UpdatedAt = time.Now().UTC()
		if err := deps.ChatService.UpdateReceipt(c.Request.Context(), req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusAccepted, gin.H{"status": "ok"})
	})

	r.GET("/ws", authMiddleware(deps.TokenManager), func(c *gin.Context) {
		userID := c.GetString("userID")
		upgrader := websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		}
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "websocket upgrade failed"})
			return
		}

		client := ws.NewClient(userID, conn, nil)
		deps.Hub.Register(client)

		go client.WritePump()
		go client.ReadPump(func([]byte) {
			// Client-side encrypted direct WS events can be parsed here.
			// Main message persistence path remains via authenticated REST.
		})

		go func() {
			<-c.Request.Context().Done()
			deps.Hub.Unregister(client)
		}()
	})

	return r
}

func authMiddleware(tm *auth.TokenManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		token := ""
		if strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimPrefix(authHeader, "Bearer ")
		}
		if token == "" {
			token = c.Query("accessToken")
		}
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing bearer token"})
			return
		}
		claims, err := tm.ParseAccess(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		c.Set("userID", claims.UserID)
		c.Set("deviceID", claims.DeviceID)
		c.Next()
	}
}

func WithTimeout(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, timeout)
}
