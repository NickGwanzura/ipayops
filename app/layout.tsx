import type { Metadata } from 'next';
import './globals.css';
import './font.css';
import { OrganizationSettingsProvider } from './organization-settings';

export const metadata: Metadata = { title: 'iPayTech Ops', description: 'Business operations control centre' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><OrganizationSettingsProvider>{children}</OrganizationSettingsProvider></body></html>;
}
