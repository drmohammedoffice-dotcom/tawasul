import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { requestPhoneEmail2fa, requestPhoneOtp, setInterests, verifyPhoneAuth } from '@/api/accounts';
import { useI18n } from '@/i18n/I18nProvider';
import { getOrCreateDeviceId } from '@/lib/session';
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
function authErrorMessage(err, t) {
    const msg = err instanceof Error ? err.message : t('errorGeneric');
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
        return t('networkError');
    }
    return msg;
}
export function PhoneAuthPanel({ mode, onAuthed, onToggleMode }) {
    const { t } = useI18n();
    const deviceId = useMemo(() => getOrCreateDeviceId(), []);
    const [dial, setDial] = useState('+964');
    const [country, setCountry] = useState('IQ');
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [username, setUsername] = useState('');
    const [step, setStep] = useState('phone');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [debugCode, setDebugCode] = useState('');
    const [pendingPayload, setPendingPayload] = useState(null);
    const [pendingUserId, setPendingUserId] = useState('');
    const [phoneChallengeId, setPhoneChallengeId] = useState('');
    const [email2fa, setEmail2fa] = useState('');
    const [interestKeys, setInterestKeys] = useState([]);
    const [channel, setChannel] = useState('sms');
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
            if (res.debugCode)
                setDebugCode(String(res.debugCode));
            if (!res.delivery?.accepted) {
                setError(t('otpDeliveryFailed'));
            }
            else {
                setStep('otp');
            }
        }
        catch (err) {
            setError(authErrorMessage(err, t));
        }
        finally {
            setBusy(false);
        }
    }
    async function verify(e) {
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
                if (res.debugCode)
                    setDebugCode(String(res.debugCode));
                return;
            }
            if (!res?.accessToken || !res?.user) {
                throw new Error(t('errorGeneric'));
            }
            const payload = {
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
        }
        catch (err) {
            setError(authErrorMessage(err, t));
        }
        finally {
            setBusy(false);
        }
    }
    async function finishInterests() {
        if (!pendingPayload)
            return;
        setBusy(true);
        try {
            // Session not published yet — publish first then save interests
            onAuthed(pendingPayload);
            if (interestKeys.length) {
                await setInterests(interestKeys);
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("div", { className: "phone-auth-panel", children: [_jsx("p", { className: "muted", children: t('phoneAuthHint') }), step === 'phone' ? (_jsxs("form", { onSubmit: (e) => {
                    e.preventDefault();
                    void sendOtp();
                }, children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: t('country') }), _jsx("select", { value: `${country}|${dial}`, onChange: (e) => {
                                    const [c, d] = e.target.value.split('|');
                                    if (c)
                                        setCountry(c);
                                    if (d)
                                        setDial(d);
                                }, children: DIALS.map((d) => (_jsx("option", { value: `${d.code}|${d.dial}`, children: d.label }, d.code))) })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: t('phone') }), _jsx("input", { value: phone, onChange: (e) => setPhone(e.target.value), inputMode: "tel", placeholder: "7xxxxxxxxx", required: true, disabled: busy })] }), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { type: "button", className: `button button-compact ${channel === 'sms' ? '' : 'button-ghost'}`, onClick: () => setChannel('sms'), children: "SMS" }), _jsx("button", { type: "button", className: `button button-compact ${channel === 'whatsapp' ? '' : 'button-ghost'}`, onClick: () => setChannel('whatsapp'), children: "WhatsApp" })] }), mode === 'register' ? (_jsxs("label", { className: "field", children: [_jsxs("span", { children: [t('username'), " (", t('optional'), ")"] }), _jsx("input", { value: username, onChange: (e) => setUsername(e.target.value.replace(/\s/g, '')), minLength: 1, maxLength: 30, pattern: "[A-Za-z0-9._]+", disabled: busy, dir: "ltr" })] })) : null, error ? _jsx("p", { className: "auth-error", children: error }) : null, _jsx("button", { className: "button", type: "submit", disabled: busy, children: busy ? t('loading') : t('sendCode') })] })) : null, step === 'otp' || step === 'email2fa' ? (_jsxs("form", { onSubmit: (e) => void verify(e), children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: step === 'email2fa' ? t('email2faCode') : t('verificationCode') }), _jsx("input", { value: step === 'email2fa' ? email2fa : code, onChange: (e) => (step === 'email2fa' ? setEmail2fa(e.target.value) : setCode(e.target.value)), inputMode: "numeric", required: true, disabled: busy })] }), debugCode ? _jsxs("p", { className: "muted tiny", children: ["dev OTP: ", debugCode] }) : null, error ? _jsx("p", { className: "auth-error", children: error }) : null, _jsx("button", { className: "button", type: "submit", disabled: busy, children: busy ? t('loading') : t('verify') }), _jsx("button", { type: "button", className: "button button-ghost", disabled: busy, onClick: () => void (async () => {
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
                                    if (res.debugCode)
                                        setDebugCode(String(res.debugCode));
                                }
                                catch (err) {
                                    setError(err instanceof Error ? err.message : t('errorGeneric'));
                                }
                                finally {
                                    setBusy(false);
                                }
                                return;
                            }
                            await sendOtp();
                        })(), children: t('resendCode') })] })) : null, step === 'interests' ? (_jsxs("div", { children: [_jsx("p", { className: "muted", children: t('pickInterests') }), _jsx("div", { className: "interest-chips", children: INTERESTS.map((k) => (_jsx("button", { type: "button", className: `chip ${interestKeys.includes(k) ? 'active' : ''}`, onClick: () => setInterestKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k])), children: k }, k))) }), _jsx("button", { type: "button", className: "button", disabled: busy || interestKeys.length < 1, onClick: () => void finishInterests(), children: t('continue') })] })) : null, _jsx("button", { className: "button button-ghost", type: "button", onClick: onToggleMode, children: mode === 'login' ? t('needAccount') : t('haveAccount') }), pendingUserId ? _jsx("span", { className: "sr-only", children: pendingUserId }) : null] }));
}
