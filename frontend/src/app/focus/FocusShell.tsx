import { Link, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/auth/AuthProvider';
import { fetchUnifiedInbox } from '@/api/focus';
import { IconChat, IconPhone, IconSettings, IconUser } from '../ui/Icons';
import { ModeToggle } from './ModeToggle';
import { applyAppearanceToDocument, loadAppearancePrefs, loadNotifPrefs } from './focusPrefs';

export function FocusShell() {
  const { t, dir } = useI18n();
  const { session } = useAuth();
  const location = useLocation();
  const [unreadTotal, setUnreadTotal] = useState(0);

  useEffect(() => {
    applyAppearanceToDocument(loadAppearancePrefs(session?.user?.id));
  }, [session?.user?.id, location.pathname]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchUnifiedInbox(80, 'focus')
        .then((items) => {
          if (cancelled) return;
          const notif = loadNotifPrefs(session?.user?.id);
          if (notif.unreadMessageCount) {
            setUnreadTotal(
              items.reduce((acc, row) => {
                if (row.muted) return acc;
                if (row.type === 'channel' && !notif.includeChannelsInBadge) return acc;
                return acc + (row.unreadCount || 0);
              }, 0)
            );
          } else {
            setUnreadTotal(
              items.filter((row) => {
                if (row.muted || !(row.unreadCount > 0)) return false;
                if (row.type === 'channel' && !notif.includeChannelsInBadge) return false;
                return true;
              }).length
            );
          }
        })
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [location.pathname, session?.user?.id]);

  const tabs = [
    {
      to: '/focus/contacts',
      label: t('focusContacts'),
      icon: <IconUser size={22} />,
      match: (p: string) => p.startsWith('/focus/contacts')
    },
    {
      to: '/focus/calls',
      label: t('focusCalls'),
      icon: <IconPhone size={22} />,
      match: (p: string) => p.startsWith('/focus/calls')
    },
    {
      to: '/focus/chats',
      label: t('focusChats'),
      icon: <IconChat size={22} />,
      match: (p: string) => p.startsWith('/focus/chats'),
      badge: unreadTotal > 0 ? (unreadTotal > 99 ? '99+' : String(unreadTotal)) : null
    },
    {
      to: '/focus/settings',
      label: t('settings'),
      icon: <IconSettings size={22} />,
      match: (p: string) => p.startsWith('/focus/settings')
    }
  ];

  const inThread =
    /\/focus\/chats\/(dm|group|channel)\//.test(location.pathname) ||
    location.pathname.startsWith('/focus/create') ||
    location.pathname.startsWith('/focus/join');

  return (
    <div className={`focus-shell${inThread ? ' focus-thread-open' : ''}`} dir={dir}>
      <header className="focus-topbar">
        <span className="brand-mark">{t('brand')}</span>
        <ModeToggle />
      </header>

      <div className="focus-body">
        <nav className="focus-dock" aria-label={t('focusNav')}>
          {tabs.map((tab) => {
            const active = tab.match(location.pathname);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                aria-label={tab.label}
                className={active ? 'focus-dock-item active' : 'focus-dock-item'}
              >
                <span className="focus-dock-icon">
                  {tab.icon}
                  {tab.badge ? <span className="focus-dock-badge">{tab.badge}</span> : null}
                </span>
                <span className="focus-dock-label">{tab.label}</span>
              </Link>
            );
          })}
        </nav>

        <main className="focus-main">
          <div className="focus-main-inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
