package auth

import (
	"context"
	"errors"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type Service struct {
	repo   *Repository
	tokens *TokenManager
}

type LoginResult struct {
	UserID       string `json:"userId"`
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
}

func NewService(repo *Repository, tokens *TokenManager) *Service {
	return &Service{repo: repo, tokens: tokens}
}

func (s *Service) Register(ctx context.Context, username, password, deviceID string) (*LoginResult, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	userID, err := s.repo.CreateUser(ctx, username, string(hash))
	if err != nil {
		return nil, err
	}
	return s.issueTokens(ctx, userID, deviceID)
}

func (s *Service) Login(ctx context.Context, username, password, deviceID string) (*LoginResult, error) {
	userID, hash, err := s.repo.GetCredentials(ctx, username)
	if err != nil {
		return nil, errors.New("invalid credentials")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return nil, errors.New("invalid credentials")
	}
	return s.issueTokens(ctx, userID, deviceID)
}

func (s *Service) Refresh(ctx context.Context, refreshToken string) (*LoginResult, error) {
	if err := s.repo.ValidateRefreshToken(ctx, refreshToken); err != nil {
		return nil, err
	}
	claims, err := s.tokens.ParseRefresh(refreshToken)
	if err != nil {
		return nil, err
	}

	_ = s.repo.RevokeRefreshToken(ctx, refreshToken)
	return s.issueTokens(ctx, claims.UserID, claims.DeviceID)
}

func (s *Service) issueTokens(ctx context.Context, userID, deviceID string) (*LoginResult, error) {
	access, refresh, err := s.tokens.GeneratePair(userID, deviceID)
	if err != nil {
		return nil, err
	}
	exp := time.Now().Add(time.Duration(s.tokens.refreshTTLHours) * time.Hour)
	if err := s.repo.SaveRefreshToken(ctx, userID, deviceID, refresh, exp); err != nil {
		return nil, err
	}
	return &LoginResult{
		UserID:       userID,
		AccessToken:  access,
		RefreshToken: refresh,
	}, nil
}
