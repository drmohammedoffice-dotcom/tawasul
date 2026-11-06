package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}

	cfg.MaxConns = 60
	cfg.MinConns = 5
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.MaxConnLifetime = 45 * time.Minute

	return pgxpool.NewWithConfig(ctx, cfg)
}
