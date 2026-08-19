'use client';

import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { DEFAULT_ORGANIZATION_SETTINGS, type OrganizationSettings } from '@/lib/organization-settings';
export { formatCurrency, formatOrganizationDate } from '@/lib/organization-settings';
export type { OrganizationSettings } from '@/lib/organization-settings';

const SettingsContext = createContext<OrganizationSettings>(DEFAULT_ORGANIZATION_SETTINGS);

export function OrganizationSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_ORGANIZATION_SETTINGS);
  useEffect(() => {
    void fetch('/api/organization-settings', { cache: 'no-store' })
      .then(async response => response.ok ? response.json() : null)
      .then(data => { if (data?.settings) setSettings({ ...DEFAULT_ORGANIZATION_SETTINGS, ...data.settings }); })
      .catch(() => undefined);
  }, []);
  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>;
}

export function useOrganizationSettings() {
  return useContext(SettingsContext);
}
