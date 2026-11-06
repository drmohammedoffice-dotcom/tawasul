import { useI18n } from '@/i18n/I18nProvider';
import { useAppMode } from './AppModeContext';

export function ModeToggle() {
  const { t } = useI18n();
  const { mode, setMode } = useAppMode();

  return (
    <div
      className="mode-toggle"
      role="tablist"
      aria-label={t('appMode')}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'browse'}
        className={`mode-toggle-btn${mode === 'browse' ? ' is-active' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMode('browse');
        }}
      >
        {t('modeBrowse')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'focus'}
        className={`mode-toggle-btn${mode === 'focus' ? ' is-active' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMode('focus');
        }}
      >
        {t('modeFocus')}
      </button>
    </div>
  );
}
