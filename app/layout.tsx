import type { Metadata } from 'next';
import './globals.css';
import './font.css';
import './sitewide-spacing.css';
import { OrganizationSettingsProvider } from './organization-settings';

export const metadata: Metadata = {
  metadataBase: new URL('https://ipaytechops.com'),
  title: {
    default: 'iPayTech Operations',
    template: '%s | iPayTech Operations',
  },
  description:
    'iPayTech Operations control centre for serialized inventory, sales, jobs, warranties, finance, and HR.',
  applicationName: 'iPayTech Operations',
  authors: [{ name: 'iPayTech' }],
  creator: 'iPayTech',
  publisher: 'iPayTech',
  keywords: [
    'iPayTech',
    'operations management',
    'serialized inventory',
    'sales CRM',
    'warranty management',
    'Harare',
  ],
  alternates: { canonical: '/' },
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'iPayTech Operations',
    title: 'iPayTech Operations',
    description:
      'Operations control centre for serialized inventory, sales, jobs, warranties, finance, and HR.',
    images: [{ url: '/iPaytechLogo.jpg', width: 1000, height: 420, alt: 'iPayTech Operations' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'iPayTech Operations',
    description:
      'Operations control centre for serialized inventory, sales, jobs, warranties, finance, and HR.',
    images: ['/iPaytechLogo.jpg'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><OrganizationSettingsProvider>{children}</OrganizationSettingsProvider></body></html>;
}
