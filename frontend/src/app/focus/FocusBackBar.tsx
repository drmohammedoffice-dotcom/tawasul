import { useNavigate } from 'react-router-dom';
import { IconBack } from '../ui/Icons';

type Props = {
  title?: string;
  subtitle?: string;
  fallbackTo?: string;
  onBack?: () => void;
  trailing?: React.ReactNode;
  unreadHint?: string | number | null;
};

export function FocusBackBar({
  title,
  subtitle,
  fallbackTo = '/focus/chats',
  onBack,
  trailing,
  unreadHint
}: Props) {
  const navigate = useNavigate();

  function goBack() {
    if (onBack) {
      onBack();
      return;
    }
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(fallbackTo);
  }

  return (
    <header className="focus-back-bar">
      <button type="button" className="focus-back-btn" onClick={goBack} aria-label="Back">
        <IconBack size={20} />
        {unreadHint != null && unreadHint !== '' ? (
          <span className="focus-back-badge">{unreadHint}</span>
        ) : null}
      </button>
      {title ? (
        <div className="focus-back-titles">
          <strong className="ellipsis">{title}</strong>
          {subtitle ? <span className="muted tiny ellipsis">{subtitle}</span> : null}
        </div>
      ) : (
        <span />
      )}
      <div className="focus-back-trailing">{trailing}</div>
    </header>
  );
}
