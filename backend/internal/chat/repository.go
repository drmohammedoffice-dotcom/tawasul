package chat

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) SaveMessage(ctx context.Context, msg MessageEnvelope) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO messages (
			id, chat_id, sender_user_id, ciphertext_b64, nonce_b64,
			key_version, message_type, client_msg_id, reply_to_message_id, metadata
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
	`, msg.ID, msg.ChatID, msg.SenderUserID, msg.CiphertextB64, msg.NonceB64, msg.KeyVersion, msg.MessageType, msg.ClientMsgID, msg.ReplyToMessageID, msg.Metadata)
	return err
}

func (r *Repository) CreateChat(ctx context.Context, c Chat, memberIDs []string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
		INSERT INTO chats (id, type, title, created_by, created_at)
		VALUES ($1, $2, $3, $4, $5)
	`, c.ID, c.Type, c.Title, c.CreatedBy, c.CreatedAt)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO chat_members (chat_id, user_id, role, joined_at)
		VALUES ($1, $2, 'owner', $3)
	`, c.ID, c.CreatedBy, time.Now().UTC())
	if err != nil {
		return err
	}

	for _, memberID := range memberIDs {
		if memberID == c.CreatedBy {
			continue
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO chat_members (chat_id, user_id, role, joined_at)
			VALUES ($1, $2, 'member', $3)
			ON CONFLICT DO NOTHING
		`, c.ID, memberID, time.Now().UTC())
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (r *Repository) MarkDelivery(ctx context.Context, receipt DeliveryReceipt) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO message_receipts (message_id, user_id, status, updated_at)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (message_id, user_id)
		DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
	`, receipt.MessageID, receipt.UserID, receipt.Status, receipt.UpdatedAt)
	return err
}

func (r *Repository) IsMember(ctx context.Context, chatID, userID string) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM chat_members
			WHERE chat_id = $1 AND user_id = $2
		)
	`, chatID, userID).Scan(&exists)
	return exists, err
}
