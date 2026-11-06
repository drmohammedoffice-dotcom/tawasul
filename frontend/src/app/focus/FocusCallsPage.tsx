import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchCallHistory, type CallHistoryItem } from '@/api/focus';
import { startDmCallRest } from '@/api/messagingExtras';
import { useI18n } from '@/i18n/I18nProvider';
import { ErrorBanner, PageLoader } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import { IconPhone, IconVideo } from '../ui/Icons';

export function FocusCallsPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'missed'>('all');
  const [items, setItems] = useState<CallHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchCallHistory(filter)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('errorGeneric'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, t]);

  async function recall(item: CallHistoryItem) {
    if (item.scope === 'dm' && item.peer?.id) {
      try {
        await startDmCallRest(item.peer.id, item.kind);
        navigate(`/focus/chats/dm/${item.peer.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errorGeneric'));
      }
    }
  }

  return (
    <div className="focus-calls">
      <div className="focus-chats-header">
        <button type="button" className="focus-back-btn compact" onClick={() => navigate('/focus/chats')}>
          ←
        </button>
        <h1>{t('focusCalls')}</h1>
        <span />
      </div>
      <div className="focus-segmented" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={filter === 'all' ? 'is-active' : ''}
          onClick={() => setFilter('all')}
        >
          {t('callsAll')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'missed'}
          className={filter === 'missed' ? 'is-active' : ''}
          onClick={() => setFilter('missed')}
        >
          {t('callsMissed')}
        </button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <PageLoader /> : null}

      {!loading && items.length === 0 ? (
        <div className="focus-calls-empty">
          <p className="focus-empty-inline muted">{t('emptyCalls')}</p>
          <p className="muted center">{t('emptyCallsHint')}</p>
          <button type="button" className="focus-link-btn" onClick={() => setPickerOpen(true)}>
            <IconPhone size={18} /> {t('startNewCall')}
          </button>
        </div>
      ) : null}

      <ul className="focus-call-list">
        {items.map((item) => {
          const title =
            item.peer?.displayName ||
            item.peer?.username ||
            item.spaceName ||
            t('unknown');
          const when = new Date(item.createdAt).toLocaleString(locale === 'ar' ? 'ar' : 'en', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
          });
          return (
            <li key={item.id}>
              <button type="button" className="focus-call-row" onClick={() => void recall(item)}>
                <UserAvatar
                  size="md"
                  name={title}
                  username={item.peer?.username || title}
                  avatarUrl={item.peer?.avatarUrl}
                />
                <span className="focus-call-body">
                  <strong className={item.missed ? 'is-missed' : ''}>{title}</strong>
                  <span className="muted">
                    {item.kind === 'video' ? <IconVideo size={14} /> : <IconPhone size={14} />}{' '}
                    {item.direction === 'outgoing' ? t('outgoingCall') : t('incomingCall')}
                    {item.missed ? ` · ${t('missedCall')}` : ''} · {when}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {pickerOpen ? (
        <div className="focus-modal-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="focus-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('startNewCall')}</h2>
            <p className="muted">{t('startCallHint')}</p>
            <Link className="button" to="/focus/contacts" onClick={() => setPickerOpen(false)}>
              {t('focusContacts')}
            </Link>
            <button type="button" className="button button-ghost" onClick={() => setPickerOpen(false)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
