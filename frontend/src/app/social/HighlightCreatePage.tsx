import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addHighlightStories, createHighlight } from '@/api/accounts';
import { fetchStoriesFeed } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { ErrorBanner } from '../ui/States';
import { useToast } from '../ui/Toast';

export function HighlightCreatePage() {
  const { t } = useI18n();
  const { push } = useToast();
  const navigate = useNavigate();
  const me = getSessionSnapshot()?.user?.id;
  const [title, setTitle] = useState('');
  const [stories, setStories] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetchStoriesFeed()
      .then((rows) => setStories((rows || []).filter((s: any) => s.authorId === me || s.author?.id === me)))
      .catch(() => setStories([]));
  }, [me]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const h = (await createHighlight({ title, storyIds: selected })) as { id: string };
      if (selected.length && h.id) await addHighlightStories(h.id, selected);
      push(t('highlightCreated'), 'success');
      navigate('/profile');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t('newHighlight')}</h1>
        <Link to="/profile" className="button button-ghost button-compact">
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      <form className="create-form" onSubmit={(e) => void onSubmit(e)}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('highlightTitle')} required maxLength={40} />
        <p className="muted tiny">{t('pickStoriesForHighlight')}</p>
        {stories.map((s) => (
          <label key={s.id} className="check-row">
            <input
              type="checkbox"
              checked={selected.includes(s.id)}
              onChange={(e) =>
                setSelected((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)))
              }
            />
            {s.id.slice(0, 8)} · {s.audience || 'everyone'}
          </label>
        ))}
        {!stories.length ? <p className="muted">{t('noActiveStories')}</p> : null}
        <button className="button" type="submit">
          {t('create')}
        </button>
      </form>
    </div>
  );
}
