import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n/I18nProvider';

export function FocusSettingsHeader({ title }: { title: string }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  return (
    <div className="focus-chats-header">
      <button
        type="button"
        className="focus-back-btn compact"
        aria-label={t('back')}
        onClick={() => navigate('/focus/settings')}
      >
        ←
      </button>
      <h1>{title}</h1>
      <span />
    </div>
  );
}

export function FocusSettingsSection({
  title,
  children,
  hint
}: {
  title?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <section className="focus-settings-block">
      {title ? <h2 className="focus-settings-section-title">{title}</h2> : null}
      {children}
      {hint ? <p className="focus-settings-hint muted tiny">{hint}</p> : null}
    </section>
  );
}

export function FocusToggleRow({
  label,
  hint,
  checked,
  onChange,
  icon,
  iconClass
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  icon?: ReactNode;
  iconClass?: string;
}) {
  return (
    <div className="focus-settings-row focus-settings-row-static">
      {icon ? <span className={`focus-settings-icon ${iconClass || 'gray'}`}>{icon}</span> : null}
      <span className="focus-settings-toggle-copy">
        <strong className="block">{label}</strong>
        {hint ? <span className="muted tiny">{hint}</span> : null}
      </span>
      <label className="focus-switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="focus-switch-slider" />
      </label>
    </div>
  );
}

export function FocusNavRow({
  to,
  label,
  status,
  icon,
  iconClass,
  onClick
}: {
  to?: string;
  label: string;
  status?: string;
  icon: ReactNode;
  iconClass?: string;
  onClick?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="focus-settings-row"
      onClick={() => {
        if (onClick) onClick();
        else if (to) navigate(to);
      }}
    >
      <span className={`focus-settings-icon ${iconClass || 'gray'}`}>{icon}</span>
      <span className="focus-settings-toggle-copy">
        <strong className="block">{label}</strong>
        {status ? <span className="muted tiny">{status}</span> : null}
      </span>
      <span className="focus-settings-chevron" aria-hidden>
        ›
      </span>
    </button>
  );
}
