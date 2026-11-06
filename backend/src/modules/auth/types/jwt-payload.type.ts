export type JwtPayload = {
  sub: string;
  email: string | null;
  username: string;
  jti: string;
  sid: string;
  deviceId: string;
  type: 'access' | 'refresh';
};
