import { useI18n } from '@/i18n/I18nProvider';

export function SkeletonFeed({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton-stack" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card">
          <div className="skeleton-row">
            <div className="skeleton-avatar shimmer" />
            <div className="skeleton-lines">
              <div className="skeleton-line shimmer" />
              <div className="skeleton-line short shimmer" />
            </div>
          </div>
          <div className="skeleton-media shimmer" />
          <div className="skeleton-line shimmer" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-visual" aria-hidden />
      <h2>{title}</h2>
      {description ? <p className="muted">{description}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry
}: {
  message: string;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="error-banner" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button className="button button-compact" type="button" onClick={onRetry}>
          {t('retry')}
        </button>
      ) : null}
    </div>
  );
}

export function PageLoader() {
  const { t } = useI18n();
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <div className="spinner" />
      <span className="muted">{t('loading')}</span>
    </div>
  );
}
