package chat

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
)

const (
	RedisChannelMessages = "chat:messages"
	RedisChannelReceipts = "chat:receipts"
)

type Service struct {
	repo   *Repository
	redis  *redis.Client
	logger *slog.Logger
}

func NewService(repo *Repository, rdb *redis.Client, logger *slog.Logger) *Service {
	return &Service{repo: repo, redis: rdb, logger: logger}
}

func (s *Service) CreateChat(ctx context.Context, chatType, title, creatorUserID string, members []string) (Chat, error) {
	if chatType != "direct" && chatType != "group" && chatType != "channel" {
		return Chat{}, errors.New("invalid chat type")
	}
	c := Chat{
		ID:        uuid.NewString(),
		Type:      chatType,
		Title:     title,
		CreatedBy: creatorUserID,
		CreatedAt: time.Now().UTC(),
	}
	if err := s.repo.CreateChat(ctx, c, members); err != nil {
		return Chat{}, err
	}
	return c, nil
}

func (s *Service) SendMessage(ctx context.Context, msg MessageEnvelope) (MessageEnvelope, error) {
	if msg.ChatID == "" || msg.SenderUserID == "" || msg.CiphertextB64 == "" || msg.NonceB64 == "" {
		return MessageEnvelope{}, errors.New("missing required message fields")
	}

	member, err := s.repo.IsMember(ctx, msg.ChatID, msg.SenderUserID)
	if err != nil {
		return MessageEnvelope{}, err
	}
	if !member {
		return MessageEnvelope{}, errors.New("sender is not a member of this chat")
	}

	msg.ID = uuid.NewString()
	msg.CreatedAt = time.Now().UTC()

	if err := s.repo.SaveMessage(ctx, msg); err != nil {
		return MessageEnvelope{}, err
	}

	payload, err := json.Marshal(msg)
	if err != nil {
		return MessageEnvelope{}, err
	}
	if err := s.redis.Publish(ctx, RedisChannelMessages, payload).Err(); err != nil {
		return MessageEnvelope{}, err
	}
	s.logger.Info("encrypted message persisted and published", "chatId", msg.ChatID, "messageId", msg.ID)
	return msg, nil
}

func (s *Service) UpdateReceipt(ctx context.Context, receipt DeliveryReceipt) error {
	if receipt.Status != "sent" && receipt.Status != "delivered" && receipt.Status != "read" {
		return errors.New("invalid delivery status")
	}
	if receipt.UpdatedAt.IsZero() {
		receipt.UpdatedAt = time.Now().UTC()
	}
	if err := s.repo.MarkDelivery(ctx, receipt); err != nil {
		return err
	}
	payload, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	if err := s.redis.Publish(ctx, RedisChannelReceipts, payload).Err(); err != nil {
		return err
	}
	s.logger.Debug("delivery receipt published", "messageId", receipt.MessageID, "status", receipt.Status)
	return nil
}
