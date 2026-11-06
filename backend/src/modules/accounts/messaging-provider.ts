import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type MessageChannel = 'sms' | 'whatsapp' | 'email';

export type SendResult = {
  ok: boolean;
  provider: string;
  mocked: boolean;
  detail?: string;
};

/**
 * Pluggable messaging layer. Real SMS/WhatsApp require Twilio credentials.
 * Mock never logs OTP codes. Live path only succeeds when Twilio accepts the request.
 */
@Injectable()
export class MessagingProvider {
  private readonly logger = new Logger(MessagingProvider.name);

  constructor(private readonly config: ConfigService) {}

  get mode(): 'mock' | 'live' {
    const driver = (this.config.get<string>('OTP_MESSAGING_DRIVER') || 'mock').toLowerCase();
    return driver === 'live' ? 'live' : 'mock';
  }

  providerStatus() {
    const sid = Boolean(this.config.get<string>('TWILIO_ACCOUNT_SID')?.trim());
    const token = Boolean(this.config.get<string>('TWILIO_AUTH_TOKEN')?.trim());
    const from = Boolean(this.config.get<string>('TWILIO_FROM_NUMBER')?.trim());
    const whatsappFrom = Boolean(this.config.get<string>('TWILIO_WHATSAPP_FROM')?.trim());
    const nodeEnv = (this.config.get<string>('NODE_ENV') || 'development').toLowerCase();
    const mockInProduction = this.mode === 'mock' && nodeEnv === 'production';
    const liveReady = this.mode === 'live' && sid && token && from;
    return {
      mode: this.mode,
      smsConfigured: sid && token && from,
      whatsappConfigured: sid && token && (whatsappFrom || from),
      emailLiveConfigured: false,
      productionSafe: liveReady && !mockInProduction,
      mockAllowedForLocalDev: this.mode === 'mock' && nodeEnv !== 'production',
      note: mockInProduction
        ? 'INSECURE: OTP_MESSAGING_DRIVER=mock under NODE_ENV=production — not acceptable as real verification.'
        : this.mode === 'mock'
          ? 'Mock OTP only — not real SMS/WhatsApp delivery.'
          : liveReady
            ? 'Live Twilio path enabled when credentials present.'
            : 'Live mode selected but Twilio credentials incomplete.'
    };
  }

  async sendOtp(input: {
    channel: MessageChannel;
    to: string;
    code: string;
    purpose: string;
  }): Promise<SendResult> {
    const nodeEnv = (this.config.get<string>('NODE_ENV') || 'development').toLowerCase();
    const allowMockProd = (this.config.get<string>('OTP_ALLOW_MOCK_IN_PRODUCTION') || '')
      .toLowerCase()
      .match(/^(1|true|yes)$/);
    if (this.mode === 'mock' && nodeEnv === 'production' && !allowMockProd) {
      this.logger.warn(
        `OTP mock blocked in production channel=${input.channel} to=${this.mask(input.to)} purpose=${input.purpose}`
      );
      return {
        ok: false,
        provider: 'mock',
        mocked: true,
        detail: 'mock-blocked-in-production'
      };
    }
    if (this.mode === 'mock') {
      this.logger.log(
        `OTP mock send channel=${input.channel} to=${this.mask(input.to)} purpose=${input.purpose}`
      );
      return { ok: true, provider: 'mock', mocked: true, detail: 'mock-accepted' };
    }

    if (input.channel === 'email') {
      return this.sendEmailOtp({ to: input.to, code: input.code, purpose: input.purpose });
    }

    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID')?.trim();
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN')?.trim();
    const smsFrom = this.config.get<string>('TWILIO_FROM_NUMBER')?.trim();
    const waFrom =
      this.config.get<string>('TWILIO_WHATSAPP_FROM')?.trim() ||
      (smsFrom ? `whatsapp:${smsFrom.replace(/^whatsapp:/, '')}` : '');

    if (!sid || !token) {
      this.logger.warn('OTP live mode requested but Twilio credentials missing');
      return { ok: false, provider: 'twilio', mocked: false, detail: 'credentials-missing' };
    }

    const from =
      input.channel === 'whatsapp'
        ? waFrom.startsWith('whatsapp:')
          ? waFrom
          : `whatsapp:${waFrom}`
        : smsFrom;
    if (!from) {
      return { ok: false, provider: 'twilio', mocked: false, detail: 'from-number-missing' };
    }

    const to =
      input.channel === 'whatsapp'
        ? input.to.startsWith('whatsapp:')
          ? input.to
          : `whatsapp:${input.to}`
        : input.to;

    try {
      const body = new URLSearchParams({
        To: to,
        From: from,
        Body: `SecureChat code: ${input.code}`
      });
      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body
        }
      );
      if (!res.ok) {
        // Do not log response body (may contain PII); only status.
        this.logger.warn(`Twilio send failed status=${res.status} channel=${input.channel}`);
        return { ok: false, provider: 'twilio', mocked: false, detail: `http-${res.status}` };
      }
      this.logger.log(`Twilio OTP accepted channel=${input.channel} to=${this.mask(input.to)}`);
      return { ok: true, provider: 'twilio', mocked: false, detail: 'accepted' };
    } catch (err) {
      this.logger.warn(`Twilio send error channel=${input.channel}`);
      return {
        ok: false,
        provider: 'twilio',
        mocked: false,
        detail: err instanceof Error ? 'network-error' : 'unknown-error'
      };
    }
  }

  async sendEmailOtp(input: { to: string; code: string; purpose: string }): Promise<SendResult> {
    if (this.mode === 'mock') {
      this.logger.log(`Email OTP mock to=${this.mask(input.to)} purpose=${input.purpose}`);
      return { ok: true, provider: 'mock-email', mocked: true };
    }
    return { ok: false, provider: 'email', mocked: false, detail: 'live-email-not-wired' };
  }

  private mask(value: string): string {
    if (value.includes('@')) {
      const [u, d] = value.split('@');
      return `${(u || '').slice(0, 2)}***@${d || ''}`;
    }
    if (value.length < 6) return '***';
    return `${value.slice(0, 4)}***${value.slice(-2)}`;
  }
}
