'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'ipaytech-theme';

/**
 * Dark-mode preference that survives reloads and defaults to the operating-system setting.
 * Storage can be unavailable (private windows, blocked site data), so every access is guarded.
 */
export function useThemePreference(): [boolean, (dark: boolean) => void] {
  const [dark, setDarkState] = useState(false);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Fall through to the system preference.
    }
    if (stored === 'dark' || stored === 'light') setDarkState(stored === 'dark');
    else setDarkState(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  }, []);
  const setDark = useCallback((next: boolean) => {
    setDarkState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      // The choice still applies for this visit.
    }
  }, []);
  return [dark, setDark];
}
