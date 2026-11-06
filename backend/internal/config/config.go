package config

import (
	"log"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	AppEnv          string
	HTTPAddr        string
	PostgresDSN     string
	RedisAddr       string
	RedisPassword   string
	JWTIssuer       string
	JWTAccessSecret string
	JWTRefreshSecret string
	JWTAccessTTLMin int
	JWTRefreshTTLHr int
}

func Load() Config {
	_ = godotenv.Load()

	return Config{
		AppEnv:           getenv("APP_ENV", "development"),
		HTTPAddr:         getenv("HTTP_ADDR", ":8080"),
		PostgresDSN:      mustEnv("POSTGRES_DSN"),
		RedisAddr:        getenv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:    getenv("REDIS_PASSWORD", ""),
		JWTIssuer:        getenv("JWT_ISSUER", "securemesh"),
		JWTAccessSecret:  mustEnv("JWT_ACCESS_SECRET"),
		JWTRefreshSecret: mustEnv("JWT_REFRESH_SECRET"),
		JWTAccessTTLMin:  mustInt("JWT_ACCESS_TTL_MIN", 15),
		JWTRefreshTTLHr:  mustInt("JWT_REFRESH_TTL_HOURS", 720),
	}
}

func getenv(key, fallback string) string {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	return v
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("missing required env var: %s", key)
	}
	return v
}

func mustInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(v)
	if err != nil {
		log.Fatalf("invalid int env var %s: %v", key, err)
	}
	return parsed
}
