import { Suspense, lazy } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageLoader } from '../ui/States';

const ChatApp = lazy(() => import('../App').then((m) => ({ default: m.App })));

/**
 * Focus DM = Browse ChatScreen embedded with Focus appSpace (pathname /focus/...).
 * Full composer, media, calls, menus — same UX as Browse messaging.
 */
export function FocusDmPage() {
  const { peerId = '' } = useParams();
  const navigate = useNavigate();

  if (!peerId) {
    navigate('/focus/chats', { replace: true });
    return <PageLoader />;
  }

  return (
    <div className="focus-dm-browse">
      <Suspense fallback={<PageLoader />}>
        <ChatApp
          embeddedPeerId={peerId}
          onEmbeddedBack={() => navigate('/focus/chats')}
        />
      </Suspense>
    </div>
  );
}
