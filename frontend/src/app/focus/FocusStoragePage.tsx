import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { IconArchive, IconMegaphone, IconPhone, IconUser, IconUsers } from '../ui/Icons';
import {
  FocusSettingsHeader,
  FocusSettingsSection,
  FocusToggleRow
} from './FocusSettingsShared';
import {
  clearAppCaches,
  estimateCacheBytes,
  formatBytes,
  loadStoragePrefs,
  resetAutoDownload,
  saveStoragePrefs,
  type FocusStoragePrefs
} from './focusPrefs';

export function FocusStoragePage() {
  const { t } = useI18n();
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [prefs, setPrefs] = useState<FocusStoragePrefs>(() => loadStoragePrefs(uid));
  const [cacheBytes, setCacheBytes] = useState(0);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    setPrefs(loadStoragePrefs(uid));
    void estimateCacheBytes().then(setCacheBytes);
  }, [uid]);

  function patch(partial: Partial<FocusStoragePrefs>) {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      saveStoragePrefs(uid, next);
      return next;
    });
  }

  const off = t('notifStatusOff');
  const on = t('notifStatusOn');

  return (
    <div className="focus-settings">
      <FocusSettingsHeader title={t('dataAndStorage')} />

      <FocusSettingsSection>
        <div className="focus-settings-row focus-settings-row-static">
          <span className="focus-settings-icon orange">
            <IconArchive size={18} />
          </span>
          <span className="focus-settings-toggle-copy">
            <strong className="block">{t('storageUsage')}</strong>
            <span className="muted tiny">{formatBytes(cacheBytes)}</span>
          </span>
        </div>
        <div className="focus-settings-row focus-settings-row-static">
          <span className="focus-settings-icon purple">
            <IconArchive size={18} />
          </span>
          <span className="focus-settings-toggle-copy">
            <strong className="block">{t('dataUsage')}</strong>
            <span className="muted tiny">
              {formatBytes(prefs.dataBytesIn + prefs.dataBytesOut)}
            </span>
          </span>
        </div>
      </FocusSettingsSection>

      <FocusSettingsSection title={t('autoDownloadMedia')}>
        <FocusToggleRow
          icon={<IconPhone size={18} />}
          iconClass="green"
          label={t('whenUsingCellular')}
          hint={prefs.autoDownloadCellular ? on : off}
          checked={prefs.autoDownloadCellular}
          onChange={(v) => patch({ autoDownloadCellular: v })}
        />
        <FocusToggleRow
          icon={<IconArchive size={18} />}
          iconClass="blue"
          label={t('whenUsingWifi')}
          hint={prefs.autoDownloadWifi ? on : off}
          checked={prefs.autoDownloadWifi}
          onChange={(v) => patch({ autoDownloadWifi: v })}
        />
        <button
          type="button"
          className="focus-settings-row"
          onClick={() => setPrefs(resetAutoDownload(uid))}
        >
          <span className="focus-text-btn">{t('resetAutoDownload')}</span>
        </button>
      </FocusSettingsSection>

      <FocusSettingsSection title={t('saveToGallery')} hint={t('saveToGalleryHint')}>
        <FocusToggleRow
          icon={<IconUser size={18} />}
          iconClass="blue"
          label={t('privateChats')}
          hint={prefs.saveGalleryPrivate ? on : off}
          checked={prefs.saveGalleryPrivate}
          onChange={(v) => patch({ saveGalleryPrivate: v })}
        />
        <FocusToggleRow
          icon={<IconUsers size={18} />}
          iconClass="green"
          label={t('groups')}
          hint={prefs.saveGalleryGroups ? on : off}
          checked={prefs.saveGalleryGroups}
          onChange={(v) => patch({ saveGalleryGroups: v })}
        />
        <FocusToggleRow
          icon={<IconMegaphone size={18} />}
          iconClass="orange"
          label={t('channels')}
          hint={prefs.saveGalleryChannels ? on : off}
          checked={prefs.saveGalleryChannels}
          onChange={(v) => patch({ saveGalleryChannels: v })}
        />
      </FocusSettingsSection>

      <FocusSettingsSection hint={t('lessDataForCallsHint')}>
        <FocusToggleRow
          label={t('lessDataForCalls')}
          checked={prefs.lessDataForCalls}
          onChange={(v) => patch({ lessDataForCalls: v })}
        />
      </FocusSettingsSection>

      <FocusSettingsSection title={t('other')}>
        <button
          type="button"
          className="focus-settings-row danger"
          disabled={clearing}
          onClick={() => {
            setClearing(true);
            void clearAppCaches()
              .then(() => estimateCacheBytes())
              .then(setCacheBytes)
              .finally(() => setClearing(false));
          }}
        >
          <span>{clearing ? '…' : t('clearCache')}</span>
        </button>
      </FocusSettingsSection>
    </div>
  );
}
