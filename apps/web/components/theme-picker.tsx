'use client';

import { useEffect, useSyncExternalStore } from 'react';

type Theme = 'contrast' | 'dark' | 'light' | 'system';

const THEMES: readonly { label: string; value: Theme }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'Contrast', value: 'contrast' },
];

const STORAGE_KEY = 'wokesocial-theme';
const THEME_CHANGE_EVENT = 'wokesocial-theme-change';

function isTheme(value: string | null): value is Theme {
  return THEMES.some((theme) => theme.value === value);
}

function getClientTheme(): Theme {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isTheme(stored) ? stored : 'system';
}

function getServerTheme(): Theme {
  return 'system';
}

function subscribeToTheme(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

function subscribeToHydration() {
  return () => undefined;
}

function getHydratedClientSnapshot() {
  return true;
}

function getHydratedServerSnapshot() {
  return false;
}

function applyTheme(theme: Theme) {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export function ThemePicker() {
  const theme = useSyncExternalStore(subscribeToTheme, getClientTheme, getServerTheme);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getHydratedClientSnapshot,
    getHydratedServerSnapshot,
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function selectTheme(nextTheme: Theme) {
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  return (
    <div className="theme-picker" role="group" aria-label="Color theme">
      {THEMES.map((item) => (
        <button
          aria-pressed={theme === item.value}
          disabled={!hydrated}
          key={item.value}
          onClick={() => selectTheme(item.value)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
