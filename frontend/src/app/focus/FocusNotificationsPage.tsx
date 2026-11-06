import { useEffect, useState } from 'react';
import { fetchPushStatus } from '@/api/push';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import {
  publishPushPrefs,
  readPushPermission,
  requestPushPermission,
  startPush,
  syncPushPrefs,
  type PushPermission
} from '@/lib/pushClient';
import { IconBell, IconHeart, IconMegaphone, IconUser, IconUsers } from '../ui/Icons';
import {
  FocusSettingsHeader,
  FocusSettingsSection,
  FocusToggleRow
} from './FocusSettingsShared';
import {
  loadNotifPrefs,
  resetNotifPrefs,
  saveNotifPrefs,
  type FocusNotifPrefs
} from './focusPrefs';

export function FocusNotificationsPage() {
  const { t } = useI18n();
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [prefs, setPrefs] = useState<FocusNotifPrefs>(() => loadNotifPrefs(uid));
  const [permission, setPermission] = useState<PushPermission>('prompt');
  const [serverReady, setServerReady] = useState<boolean | null>(null);

  useEffect(() => {
    setPrefs(loadNotifPrefs(uid));
    let cancelled = false;
    void readPushPermission().then((next) => {
      if (!cancelled) setPermission(next);
    });
    if (!uid) return () => {
      cancelled = true;
    };
    void syncPushPrefs(uid).then((next) => {
      if (!cancelled) setPrefs(next);
    });
    void fetchPushStatus()
      .then((status) => {
        if (!cancelled) setServerReady(status.enabled);
      })
      .catch(() => {
        if (!cancelled) setServerReady(null);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  function patch(partial: Partial<FocusNotifPrefs>) {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      saveNotifPrefs(uid, next);
      void publishPushPrefs(next);
      return next;
    });
  }

  const statusOn = t('notifStatusOn');

  return (
    <div className="focus-settings">
      <FocusSettingsHeader title={t('notificationsAndSounds')} />

      {permission !== 'granted' && permission !== 'unsupported' ? (
        <section className="focus-settings-block focus-notif-warn">
          <div className="focus-notif-warn-inner">
            <span className="focus-settings-icon red">
              <IconBell size={18} />
            </span>
            <div>
              <strong className="block">{t('notificationsDisabled')}</strong>
              <p className="muted tiny">{t('notificationsDisabledHint')}</p>
              <button
                type="button"
                className="focus-text-btn"
                onClick={() => {
                  void requestPushPermission().then(async (next) => {
                    setPermission(next);
                    if (next === 'granted' && uid) await startPush(uid, { request: true });
                  });
                }}
              >
                {t('enableFromSettings')}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {permission === 'granted' && serverReady !== null ? (
        <p className="focus-settings-hint muted tiny">
          {serverReady ? t('pushReady') : t('pushServerOff')}
        </p>
      ) : null}

      <FocusSettingsSection title={t('messageNotifications')}>
        <FocusToggleRow
          icon={<IconUser size={18} />}
          iconClass="blue"
          label={t('privateChats')}
          hint={prefs.privateChats ? statusOn : t('notifStatusOff')}
          checked={prefs.privateChats}
          onChange={(v) => patch({ privateChats: v })}
        />
        <FocusToggleRow
          icon={<IconUsers size={18} />}
          iconClass="green"
          label={t('groups')}
          hint={prefs.groups ? statusOn : t('notifStatusOff')}
          checked={prefs.groups}
          onChange={(v) => patch({ groups: v })}
        />
        <FocusToggleRow
          icon={<IconMegaphone size={18} />}
          iconClass="orange"
          label={t('channels')}
          hint={prefs.channels ? statusOn : t('notifStatusOff')}
          checked={prefs.channels}
          onChange={(v) => patch({ channels: v })}
        />
        <FocusToggleRow
          icon={<IconBell size={18} />}
          iconClass="purple"
          label={t('stories')}
          hint={prefs.stories ? statusOn : t('notifStatusOff')}
          checked={prefs.stories}
          onChange={(v) => patch({ stories: v })}
        />
        <FocusToggleRow
          icon={<IconHeart size={18} />}
          iconClass="red"
          label={t('reactions')}
          hint={prefs.reactions ? statusOn : t('notifStatusOff')}
          checked={prefs.reactions}
          onChange={(v) => patch({ reactions: v })}
        />
      </FocusSettingsSection>

      <FocusSettingsSection title={t('inAppNotifications')}>
        <FocusToggleRow
          label={t('inAppSounds')}
          checked={prefs.inAppSounds}
          onChange={(v) => patch({ inAppSounds: v })}
        />
        <FocusToggleRow
          label={t('inAppVibrate')}
          checked={prefs.inAppVibrate}
          onChange={(v) => patch({ inAppVibrate: v })}
        />
        <FocusToggleRow
          label={t('inAppPreview')}
          checked={prefs.inAppPreview}
          onChange={(v) => patch({ inAppPreview: v })}
        />
      </FocusSettingsSection>

      <FocusSettingsSection
        title={t('lockScreen')}
        hint={t('namesOnLockScreenHint')}
      >
        <FocusToggleRow
          label={t('namesOnLockScreen')}
          checked={prefs.namesOnLockScreen}
          onChange={(v) => patch({ namesOnLockScreen: v })}
        />
      </FocusSettingsSection>

      <FocusSettingsSection title={t('badgeCounter')} hint={t('unreadCountHint')}>
        <FocusToggleRow
          label={t('includeChannels')}
          checked={prefs.includeChannelsInBadge}
          onChange={(v) => patch({ includeChannelsInBadge: v })}
        />
        <FocusToggleRow
          label={t('unreadMessageCount')}
          checked={prefs.unreadMessageCount}
          onChange={(v) => patch({ unreadMessageCount: v })}
        />
      </FocusSettingsSection>

      <FocusSettingsSection hint={t('newContactsHint')}>
        <FocusToggleRow
          label={t('newContacts')}
          checked={prefs.newContacts}
          onChange={(v) => patch({ newContacts: v })}
        />
      </FocusSettingsSection>

      <section className="focus-settings-block">
        <button
          type="button"
          className="focus-settings-row danger"
          onClick={() => {
            const next = resetNotifPrefs(uid);
            setPrefs(next);
            void publishPushPrefs(next);
          }}
        >
          <span>{t('resetAllNotifications')}</span>
        </button>
        <p className="focus-settings-hint muted tiny">{t('resetAllNotificationsHint')}</p>
      </section>
    </div>
  );
}
