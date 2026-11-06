package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type TokenManager struct {
	issuer          string
	accessSecret    []byte
	refreshSecret   []byte
	accessTTLMin    int
	refreshTTLHours int
}

type Claims struct {
	UserID   string `json:"uid"`
	DeviceID string `json:"did"`
	jwt.RegisteredClaims
}

func NewTokenManager(issuer, accessSecret, refreshSecret string, accessTTLMin, refreshTTLHours int) *TokenManager {
	return &TokenManager{
		issuer:          issuer,
		accessSecret:    []byte(accessSecret),
		refreshSecret:   []byte(refreshSecret),
		accessTTLMin:    accessTTLMin,
		refreshTTLHours: refreshTTLHours,
	}
}

func (tm *TokenManager) GeneratePair(userID, deviceID string) (accessToken string, refreshToken string, err error) {
	now := time.Now()
	accessClaims := Claims{
		UserID:   userID,
		DeviceID: deviceID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    tm.issuer,
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(tm.accessTTLMin) * time.Minute)),
		},
	}
	refreshClaims := Claims{
		UserID:   userID,
		DeviceID: deviceID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    tm.issuer,
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(tm.refreshTTLHours) * time.Hour)),
		},
	}

	accessToken, err = jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims).SignedString(tm.accessSecret)
	if err != nil {
		return "", "", err
	}
	refreshToken, err = jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims).SignedString(tm.refreshSecret)
	if err != nil {
		return "", "", err
	}
	return accessToken, refreshToken, nil
}

func (tm *TokenManager) ParseAccess(token string) (*Claims, error) {
	return tm.parse(token, tm.accessSecret)
}

func (tm *TokenManager) ParseRefresh(token string) (*Claims, error) {
	return tm.parse(token, tm.refreshSecret)
}

func (tm *TokenManager) parse(token string, secret []byte) (*Claims, error) {
	claims := &Claims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, errors.New("unexpected jwt algorithm")
		}
		return secret, nil
	})
	if err != nil {
		return nil, err
	}
	if !parsed.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
