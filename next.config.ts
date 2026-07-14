import type { NextConfig } from 'next';

const config: NextConfig = {
  // Deck images are pre-sized by sharp at ingest time and served as static
  // files, so Next's on-demand optimizer would only re-encode what we already
  // encoded. Leaving it off keeps us portable to R2 later.
  images: { unoptimized: true },
  serverExternalPackages: ['@electric-sql/pglite', 'sharp'],
};

export default config;
