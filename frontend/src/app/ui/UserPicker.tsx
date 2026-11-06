import { useEffect, useRef, useState } from 'react';
import { searchAll } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';

type UserHit = { id: string; username: string; displayName?: string | null };

export function UserPicker({
  onPick,
  disabled
}: {
  onPick: (user: UserHit) => void | Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<UserHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 1) {
      abortRef.current?.abort();
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      void searchAll(trimmed, ac.signal)
        .then((res) => setHits((res.users ?? []).slice(0, 8)))
        .catch((err) => {
          if (err?.name === 'AbortError') return;
          setError(err instanceof Error ? err.message : t('errorGeneric'));
        })
        .finally(() => setLoading(false));
    }, 280);
    return () => window.clearTimeout(timer);
  }, [q, t]);

  return (
    <div className="user-picker">
      <input
        className="search-input"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('searchPeople')}
        autoComplete="off"
      />
      {loading ? <p className="muted tiny">{t('loading')}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}
      <div className="user-picker-list">
        {hits.map((u) => (
          <button
            key={u.id}
            type="button"
            className="user-picker-item"
            disabled={disabled}
            onClick={() => void onPick(u)}
          >
            <span className="avatar-circle sm">{(u.displayName || u.username).slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>@{u.username}</strong>
              {u.displayName ? <span className="muted"> · {u.displayName}</span> : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
