export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface DeviceSession {
  deviceId: string;
  platform: string;
  linkedAt: string;
}
