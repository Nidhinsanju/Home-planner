import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets a production build be checked without touching the dev server's .next.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  experimental: {
    // Plans are saved through a server action and can carry a background floor-plan image
    // (resized in the browser, usually well under 1 MB). The default limit is 1 MB.
    serverActions: { bodySizeLimit: '8mb' },
  },
};

export default nextConfig;
