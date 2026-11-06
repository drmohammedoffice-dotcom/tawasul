package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"securemesh/backend/internal/auth"
	"securemesh/backend/internal/chat"
	"securemesh/backend/internal/config"
	"securemesh/backend/internal/platform/logger"
	"securemesh/backend/internal/platform/postgres"
	redispkg "securemesh/backend/internal/platform/redis"
	httptransport "securemesh/backend/internal/transport/http"
	"securemesh/backend/internal/transport/ws"
)

func main() {
	cfg := config.Load()
	logr := logger.New(os.Getenv("LOG_LEVEL"))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	db, err := postgres.Connect(ctx, cfg.PostgresDSN)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	rdb, err := redispkg.Connect(ctx, cfg.RedisAddr, cfg.RedisPassword)
	if err != nil {
		log.Fatal(err)
	}
	defer rdb.Close()

	tokenManager := auth.NewTokenManager(
		cfg.JWTIssuer,
		cfg.JWTAccessSecret,
		cfg.JWTRefreshSecret,
		cfg.JWTAccessTTLMin,
		cfg.JWTRefreshTTLHr,
	)

	authRepo := auth.NewRepository(db)
	authService := auth.NewService(authRepo, tokenManager)
	chatRepo := chat.NewRepository(db)
	chatService := chat.NewService(chatRepo, rdb, logr)
	hub := ws.NewHub(rdb, logr)
	hub.RunSubscriptions(ctx, chat.RedisChannelMessages, chat.RedisChannelReceipts)

	router := httptransport.NewRouter(httptransport.RouterDeps{
		AuthService:  authService,
		TokenManager: tokenManager,
		ChatService:  chatService,
		Hub:          hub,
	})

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           router,
		ReadTimeout:       15 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		logr.Info("api-gateway listening", slog.String("addr", cfg.HTTPAddr))
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer shutdownCancel()
	_ = server.Shutdown(shutdownCtx)
}
