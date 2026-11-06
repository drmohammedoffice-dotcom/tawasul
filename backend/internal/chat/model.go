package chat

import "time"

type Chat struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"`
	Title     string    `json:"title,omitempty"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
}

type MessageEnvelope struct {
	ID             string                 `json:"id"`
	ChatID          string                 `json:"chatId"`
	SenderUserID    string                 `json:"senderUserId"`
	CiphertextB64   string                 `json:"ciphertextB64"`
	NonceB64        string                 `json:"nonceB64"`
	KeyVersion      int                    `json:"keyVersion"`
	MessageType     string                 `json:"messageType"`
	ClientMsgID     string                 `json:"clientMsgId"`
	ReplyToMessageID *string               `json:"replyToMessageId,omitempty"`
	Metadata        map[string]any         `json:"metadata,omitempty"`
	CreatedAt       time.Time              `json:"createdAt"`
}

type DeliveryReceipt struct {
	MessageID string    `json:"messageId"`
	UserID    string    `json:"userId"`
	Status    string    `json:"status"` // sent, delivered, read
	UpdatedAt time.Time `json:"updatedAt"`
}
