'use client';

import { useEffect, useState } from 'react';

type CachedUser = Record<string, unknown>;
let cached: CachedUser | null = null;
let inflight: Promise<CachedUser | null> | null = null;

function loadCurrentUser(): Promise<CachedUser | null> {
  if (cached) return Promise.resolve(cached);
  inflight ??= fetch('/api/auth/me', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return null;
      const data = (await response.json()) as { user?: CachedUser };
      cached = data.user ?? null;
      return cached;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * The signed-in user, fetched once per browser session and shared between pages (soft navigation no longer
 * refetches it). Redirects to the login page when there is no valid session.
 */
export function useCurrentUser<T extends { role: string }>(): T | null {
  const [user, setUser] = useState<T | null>((cached as T | null) ?? null);
  useEffect(() => {
    let active = true;
    void loadCurrentUser().then((value) => {
      if (!active) return;
      if (!value) {
        window.location.href = '/login';
        return;
      }
      setUser(value as T);
    });
    return () => {
      active = false;
    };
  }, []);
  return user;
}
