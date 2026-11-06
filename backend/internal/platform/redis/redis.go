package redis

import (
	"context"

	goredis "github.com/go-redis/redis/v8"
)

func Connect(ctx context.Context, addr, password string) (*goredis.Client, error) {
	client := goredis.NewClient(&goredis.Options{
		Addr:     addr,
		Password: password,
		DB:       0,
	})
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, err
	}
	return client, nil
}
