import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'iPayTech Operations',
    short_name: 'iPayTech Ops',
    description:
      'Operations control centre for serialized inventory, sales, jobs, warranties, finance, and HR.',
    start_url: '/login',
    display: 'standalone',
    background_color: '#f6f8fb',
    theme_color: '#101c32',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
