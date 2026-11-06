import { FormEvent, useMemo, useState } from 'react';
import { requestPhoneEmail2fa, requestPhoneOtp, setInterests, verifyPhoneAuth } from '@/api/accounts';
import { useI18n } from '@/i18n/I18nProvider';
import { getOrCreateDeviceId } from '@/lib/session';
import type { AuthPayload } from '@/types/api';

const DIALS = [
  { code: 'IQ', dial: '+964', label: 'Iraq (+964)' },
  { code: 'SA', dial: '+966', label: 'Saudi (+966)' },
  { code: 'AE', dial: '+971', label: 'UAE (+971)' },
  { code: 'EG', dial: '+20', label: 'Egypt (+20)' },
  { code: 'US', dial: '+1', label: 'US (+1)' }
];

const INTERESTS = [
  'medicine',
  'sports',
  'science',
  'technology',
  'education',
  'business',
  'news',
  'arts',
  'travel',
  'food',
  'fashion',
  'other'
];

function authErrorMessage(err: unknown, t: (k: 'networkError' | 'errorGeneric') => string): string {
  const msg = err instanceof Error ? err.message : t('errorGeneric');
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return t('networkError');
  }
  return msg;
}

export function PhoneAuthPanel({
  mode,
  onAuthed,
  onToggleMode
}: {
  mode: 'login' | 'register';
  onAuthed: (s: AuthPayload) => void;
  onToggleMode: () => void;
}) {
  const { t } = useI18n();
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const [dial, setDial] = useState('+964');
  const [country, setCountry] = useState('IQ');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [step, setStep] = useState<'phone' | 'otp' | 'interests' | 'email2fa'>('phone');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [debugCode, setDebugCode] = useState('');
  const [pendingPayload, setPendingPayload] = useState<AuthPayload | null>(null);
  const [pendingUserId, setPendingUserId] = useState('');
  const [phoneChallengeId, setPhoneChallengeId] = useState('');
  const [email2fa, setEmail2fa] = useState('');
  const [interestKeys, setInterestKeys] = useState<string[]>([]);
  const [channel, setChannel] = useState<'sms' | 'whatsapp'>('sms');

  async function sendOtp() {
    setBusy(true);
    setError('');
    try {
      const res = await requestPhoneOtp({
        phone,
        dialPrefix: dial,
        purpose: mode,
        channel
      });
      if (res.debugCode) setDebugCode(String(res.debugCode));
      if (!res.delivery?.accepted) {
        setError(t('otpDeliveryFailed'));
      } else {
        setStep('otp');
      }
    } catch (err) {
      setError(authErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await verifyPhoneAuth({
        phone,
        dialPrefix: dial,
        code,
        purpose: mode,
        deviceId,
        username: mode === 'register' ? username || undefined : undefined,
        countryCode: country,
        interestKeys: mode === 'register' ? interestKeys : undefined,
        email2faCode: email2fa || undefined
      });
      if (res.requiresEmail2fa) {
        setPendingUserId(String(res.userId || ''));
        setPhoneChallengeId(String(res.phoneChallengeId || ''));
        setStep('email2fa');
        if (res.debugCode) setDebugCode(String(res.debugCode));
        return;
      }
      if (!res?.accessToken || !res?.user) {
        throw new Error(t('errorGeneric'));
      }
      const payload: AuthPayload = {
        user: res.user,
        accessToken: res.accessToken,
        refreshToken: res.refreshToken
      };
      if (mode === 'register' && !interestKeys.length) {
        setPendingPayload(payload);
        setStep('interests');
        return;
      }
      onAuthed(payload);
    } catch (err) {
      setError(authErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function finishInterests() {
    if (!pendingPayload) return;
    setBusy(true);
    try {
      // Session not published yet — publish first then save interests
      onAuthed(pendingPayload);
      if (interestKeys.length) {
        await setInterests(interestKeys);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="phone-auth-panel">
      <p className="muted">{t('phoneAuthHint')}</p>
      {step === 'phone' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendOtp();
          }}
        >
          <label className="field">
            <span>{t('country')}</span>
            <select
              value={`${country}|${dial}`}
              onChange={(e) => {
                const [c, d] = e.target.value.split('|');
                if (c) setCountry(c);
                if (d) setDial(d);
              }}
            >
              {DIALS.map((d) => (
                <option key={d.code} value={`${d.code}|${d.dial}`}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('phone')}</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="7xxxxxxxxx"
              required
              disabled={busy}
            />
          </label>
          <div className="inline-actions">
            <button type="button" className={`button button-compact ${channel === 'sms' ? '' : 'button-ghost'}`} onClick={() => setChannel('sms')}>
              SMS
            </button>
            <button
              type="button"
              className={`button button-compact ${channel === 'whatsapp' ? '' : 'button-ghost'}`}
              onClick={() => setChannel('whatsapp')}
            >
              WhatsApp
            </button>
          </div>
          {mode === 'register' ? (
            <label className="field">
              <span>{t('username')} ({t('optional')})</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
                minLength={1}
                maxLength={30}
                pattern="[A-Za-z0-9._]+"
                disabled={busy}
                dir="ltr"
              />
            </label>
          ) : null}
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="button" type="submit" disabled={busy}>
            {busy ? t('loading') : t('sendCode')}
          </button>
        </form>
      ) : null}

      {step === 'otp' || step === 'email2fa' ? (
        <form onSubmit={(e) => void verify(e)}>
          <label className="field">
            <span>{step === 'email2fa' ? t('email2faCode') : t('verificationCode')}</span>
            <input
              value={step === 'email2fa' ? email2fa : code}
              onChange={(e) => (step === 'email2fa' ? setEmail2fa(e.target.value) : setCode(e.target.value))}
              inputMode="numeric"
              required
              disabled={busy}
            />
          </label>
          {debugCode ? <p className="muted tiny">dev OTP: {debugCode}</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="button" type="submit" disabled={busy}>
            {busy ? t('loading') : t('verify')}
          </button>
          <button
            type="button"
            className="button button-ghost"
            disabled={busy}
            onClick={() =>
              void (async () => {
                if (step === 'email2fa' && pendingUserId && phoneChallengeId) {
                  setBusy(true);
                  setError('');
                  try {
                    const res = await requestPhoneEmail2fa({
                      userId: pendingUserId,
                      phoneChallengeId,
                      phone,
                      dialPrefix: dial,
                      purpose: mode,
                      code
                    });
                    if (res.debugCode) setDebugCode(String(res.debugCode));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : t('errorGeneric'));
                  } finally {
                    setBusy(false);
                  }
                  return;
                }
                await sendOtp();
              })()
            }
          >
            {t('resendCode')}
          </button>
        </form>
      ) : null}

      {step === 'interests' ? (
        <div>
          <p className="muted">{t('pickInterests')}</p>
          <div className="interest-chips">
            {INTERESTS.map((k) => (
              <button
                key={k}
                type="button"
                className={`chip ${interestKeys.includes(k) ? 'active' : ''}`}
                onClick={() =>
                  setInterestKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))
                }
              >
                {k}
              </button>
            ))}
          </div>
          <button type="button" className="button" disabled={busy || interestKeys.length < 1} onClick={() => void finishInterests()}>
            {t('continue')}
          </button>
        </div>
      ) : null}

      <button className="button button-ghost" type="button" onClick={onToggleMode}>
        {mode === 'login' ? t('needAccount') : t('haveAccount')}
      </button>
      {pendingUserId ? <span className="sr-only">{pendingUserId}</span> : null}
    </div>
  );
}
