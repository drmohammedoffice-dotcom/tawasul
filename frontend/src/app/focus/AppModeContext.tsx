import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export type AppMode = 'browse' | 'focus';

const STORAGE_KEY = 'securechat-app-mode';

type AppModeContextValue = {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;
  isFocus: boolean;
};

const AppModeContext = createContext<AppModeContextValue | null>(null);

function readStoredMode(): AppMode {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'focus' || v === 'browse') return v;
  } catch {
    /* ignore */
  }
  return 'browse';
}

function persistMode(mode: AppMode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function AppModeProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const switchingRef = useRef(false);
  const bootstrapped = useRef(false);

  const pathMode: AppMode = location.pathname.startsWith('/focus') ? 'focus' : 'browse';
  const [mode, setModeState] = useState<AppMode>(() =>
    typeof window !== 'undefined' ? readStoredMode() : 'browse'
  );

  // Keep mode aligned with the URL (source of truth while navigating).
  useEffect(() => {
    if (switchingRef.current) {
      switchingRef.current = false;
    }
    setModeState(pathMode);
    persistMode(pathMode);
  }, [pathMode]);

  // On first authenticated load, honor stored preference once.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const preferred = readStoredMode();
    if (preferred === 'focus' && !location.pathname.startsWith('/focus')) {
      switchingRef.current = true;
      navigate('/focus/chats', { replace: true });
    } else if (preferred === 'browse' && location.pathname.startsWith('/focus')) {
      // Stay on focus route if user opened a focus deep link; path wins.
      persistMode('focus');
    }
  }, [location.pathname, navigate]);

  const setMode = useCallback(
    (next: AppMode) => {
      if (next === mode && (next === 'focus' ? location.pathname.startsWith('/focus') : !location.pathname.startsWith('/focus'))) {
        return;
      }
      switchingRef.current = true;
      setModeState(next);
      persistMode(next);
      if (next === 'focus') {
        if (!location.pathname.startsWith('/focus')) {
          navigate('/focus/chats');
        }
      } else if (location.pathname.startsWith('/focus')) {
        navigate('/feed');
      }
    },
    [location.pathname, mode, navigate]
  );

  const toggleMode = useCallback(() => {
    setMode(mode === 'browse' ? 'focus' : 'browse');
  }, [mode, setMode]);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      toggleMode,
      isFocus: mode === 'focus'
    }),
    [mode, setMode, toggleMode]
  );

  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>;
}

export function useAppMode() {
  const ctx = useContext(AppModeContext);
  if (!ctx) {
    throw new Error('useAppMode must be used within AppModeProvider');
  }
  return ctx;
}
