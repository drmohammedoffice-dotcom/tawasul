const KEY = 'securechat.searchHistory.v1';
const MAX = 30;

export type SearchHistoryItem = {
  q: string;
  savedAt: number;
};

export function listSearchHistory(): SearchHistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function pushSearchHistory(q: string) {
  const trimmed = q.trim();
  if (trimmed.length < 1) return;
  const next = [
    { q: trimmed, savedAt: Date.now() },
    ...listSearchHistory().filter((h) => h.q.toLowerCase() !== trimmed.toLowerCase())
  ].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function removeSearchHistory(q: string) {
  const next = listSearchHistory().filter((h) => h.q !== q);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function clearSearchHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
