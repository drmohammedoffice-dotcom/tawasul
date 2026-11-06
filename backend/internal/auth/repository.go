package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) CreateUser(ctx context.Context, username, passwordHash string) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO users (username, password_hash)
		VALUES ($1, $2)
		RETURNING id
	`, username, passwordHash).Scan(&id)
	return id, err
}

func (r *Repository) GetCredentials(ctx context.Context, username string) (userID, passwordHash string, err error) {
	err = r.db.QueryRow(ctx, `
		SELECT id, password_hash
		FROM users
		WHERE username = $1
	`, username).Scan(&userID, &passwordHash)
	return userID, passwordHash, err
}

func (r *Repository) SaveRefreshToken(ctx context.Context, userID, deviceID, refreshToken string, expiresAt time.Time) error {
	hash := hashToken(refreshToken)
	_, err := r.db.Exec(ctx, `
		INSERT INTO refresh_tokens (user_id, device_id, token_hash, expires_at)
		VALUES ($1, $2, $3, $4)
	`, userID, deviceID, hash, expiresAt)
	return err
}

func (r *Repository) RevokeRefreshToken(ctx context.Context, refreshToken string) error {
	hash := hashToken(refreshToken)
	res, err := r.db.Exec(ctx, `
		DELETE FROM refresh_tokens
		WHERE token_hash = $1
	`, hash)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return errors.New("refresh token not found")
	}
	return nil
}

func (r *Repository) ValidateRefreshToken(ctx context.Context, refreshToken string) error {
	hash := hashToken(refreshToken)
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM refresh_tokens
			WHERE token_hash = $1
			  AND expires_at > NOW()
		)
	`, hash).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return errors.New("invalid refresh token")
	}
	return nil
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
