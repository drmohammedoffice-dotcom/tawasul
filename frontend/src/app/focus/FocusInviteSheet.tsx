import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';

type Props = {
  open: boolean;
  onClose: () => void;
  url: string;
  title?: string;
  shareText?: string;
};

export function FocusInviteSheet({ open, onClose, url, title, shareText }: Props) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const displayUrl = useMemo(() => url, [url]);

  if (!open) return null;

  async function copy() {
    setError('');
    try {
      await navigator.clipboard.writeText(displayUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = displayUrl;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        setError(t('errorGeneric'));
      }
    }
  }

  async function share() {
    setError('');
    const text = shareText || t('inviteFriendsShare');
    try {
      if (navigator.share) {
        await navigator.share({ title: title || 'SecureChat', text, url: displayUrl });
        return;
      }
      await copy();
    } catch (err) {
      // User cancelled share sheet — ignore AbortError
      if (err instanceof DOMException && err.name === 'AbortError') return;
      await copy();
    }
  }

  return (
    <div className="focus-sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="focus-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('inviteFriends')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="focus-sheet-handle" />
        <h2>{t('inviteFriends')}</h2>
        <p className="muted tiny">{t('inviteLinkHint')}</p>
        <div className="focus-invite-link-box">
          <span className="focus-invite-url">{displayUrl}</span>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {copied ? <p className="success-text">{t('inviteLinkCopied')}</p> : null}
        <div className="focus-sheet-actions">
          <button type="button" className="button" onClick={() => void copy()}>
            {t('copyInviteLink')}
          </button>
          <button type="button" className="button button-ghost" onClick={() => void share()}>
            {t('shareOutsideApp')}
          </button>
          <button type="button" className="button button-ghost" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}
