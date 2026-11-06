import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchPost } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { ErrorBanner, PageLoader } from '../ui/States';
import { PostCard } from './PostCard';

export function PostDetailPage() {
  const { postId = '' } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const me = getSessionSnapshot()?.user?.id;
  const [post, setPost] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void fetchPost(postId)
      .then(setPost)
      .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
      .finally(() => setLoading(false));
  }, [postId, t]);

  if (loading) return <PageLoader />;
  if (error) return <ErrorBanner message={error} />;
  if (!post) return <ErrorBanner message={t('emptyPosts')} />;

  const backTo =
    me && post.authorId === me
      ? '/profile'
      : post.author?.username
        ? `/u/${post.author.username}`
        : '/feed';

  return (
    <div>
      <div className="page-header">
        <button
          type="button"
          className="button button-ghost button-compact"
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate(backTo);
          }}
        >
          ← {t('back')}
        </button>
        <h1>{t('posts')}</h1>
        <Link to={backTo} className="button button-ghost button-compact">
          {t('profile')}
        </Link>
      </div>
      <PostCard
        post={post}
        onChange={setPost}
        onRemoved={() => navigate(backTo)}
      />
    </div>
  );
}
