import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { IconArchive, IconMegaphone, IconPhone, IconUser, IconUsers } from '../ui/Icons';
import { FocusSettingsHeader, FocusSettingsSection, FocusToggleRow } from './FocusSettingsShared';
import { clearAppCaches, estimateCacheBytes, formatBytes, loadStoragePrefs, resetAutoDownload, saveStoragePrefs } from './focusPrefs';
export function FocusStoragePage() {
    const { t } = useI18n();
    const { session } = useAuth();
    const uid = session?.user?.id;
    const [prefs, setPrefs] = useState(() => loadStoragePrefs(uid));
    const [cacheBytes, setCacheBytes] = useState(0);
    const [clearing, setClearing] = useState(false);
    useEffect(() => {
        setPrefs(loadStoragePrefs(uid));
        void estimateCacheBytes().then(setCacheBytes);
    }, [uid]);
    function patch(partial) {
        setPrefs((prev) => {
            const next = { ...prev, ...partial };
            saveStoragePrefs(uid, next);
            return next;
        });
    }
    const off = t('notifStatusOff');
    const on = t('notifStatusOn');
    return (_jsxs("div", { className: "focus-settings", children: [_jsx(FocusSettingsHeader, { title: t('dataAndStorage') }), _jsxs(FocusSettingsSection, { children: [_jsxs("div", { className: "focus-settings-row focus-settings-row-static", children: [_jsx("span", { className: "focus-settings-icon orange", children: _jsx(IconArchive, { size: 18 }) }), _jsxs("span", { className: "focus-settings-toggle-copy", children: [_jsx("strong", { className: "block", children: t('storageUsage') }), _jsx("span", { className: "muted tiny", children: formatBytes(cacheBytes) })] })] }), _jsxs("div", { className: "focus-settings-row focus-settings-row-static", children: [_jsx("span", { className: "focus-settings-icon purple", children: _jsx(IconArchive, { size: 18 }) }), _jsxs("span", { className: "focus-settings-toggle-copy", children: [_jsx("strong", { className: "block", children: t('dataUsage') }), _jsx("span", { className: "muted tiny", children: formatBytes(prefs.dataBytesIn + prefs.dataBytesOut) })] })] })] }), _jsxs(FocusSettingsSection, { title: t('autoDownloadMedia'), children: [_jsx(FocusToggleRow, { icon: _jsx(IconPhone, { size: 18 }), iconClass: "green", label: t('whenUsingCellular'), hint: prefs.autoDownloadCellular ? on : off, checked: prefs.autoDownloadCellular, onChange: (v) => patch({ autoDownloadCellular: v }) }), _jsx(FocusToggleRow, { icon: _jsx(IconArchive, { size: 18 }), iconClass: "blue", label: t('whenUsingWifi'), hint: prefs.autoDownloadWifi ? on : off, checked: prefs.autoDownloadWifi, onChange: (v) => patch({ autoDownloadWifi: v }) }), _jsx("button", { type: "button", className: "focus-settings-row", onClick: () => setPrefs(resetAutoDownload(uid)), children: _jsx("span", { className: "focus-text-btn", children: t('resetAutoDownload') }) })] }), _jsxs(FocusSettingsSection, { title: t('saveToGallery'), hint: t('saveToGalleryHint'), children: [_jsx(FocusToggleRow, { icon: _jsx(IconUser, { size: 18 }), iconClass: "blue", label: t('privateChats'), hint: prefs.saveGalleryPrivate ? on : off, checked: prefs.saveGalleryPrivate, onChange: (v) => patch({ saveGalleryPrivate: v }) }), _jsx(FocusToggleRow, { icon: _jsx(IconUsers, { size: 18 }), iconClass: "green", label: t('groups'), hint: prefs.saveGalleryGroups ? on : off, checked: prefs.saveGalleryGroups, onChange: (v) => patch({ saveGalleryGroups: v }) }), _jsx(FocusToggleRow, { icon: _jsx(IconMegaphone, { size: 18 }), iconClass: "orange", label: t('channels'), hint: prefs.saveGalleryChannels ? on : off, checked: prefs.saveGalleryChannels, onChange: (v) => patch({ saveGalleryChannels: v }) })] }), _jsx(FocusSettingsSection, { hint: t('lessDataForCallsHint'), children: _jsx(FocusToggleRow, { label: t('lessDataForCalls'), checked: prefs.lessDataForCalls, onChange: (v) => patch({ lessDataForCalls: v }) }) }), _jsx(FocusSettingsSection, { title: t('other'), children: _jsx("button", { type: "button", className: "focus-settings-row danger", disabled: clearing, onClick: () => {
                        setClearing(true);
                        void clearAppCaches()
                            .then(() => estimateCacheBytes())
                            .then(setCacheBytes)
                            .finally(() => setClearing(false));
                    }, children: _jsx("span", { children: clearing ? '…' : t('clearCache') }) }) })] }));
}
