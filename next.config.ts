import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Plans are saved through a server action and can carry a background floor-plan image
    // (resized in the browser, usually well under 1 MB). The default limit is 1 MB.
    serverActions: { bodySizeLimit: '8mb' },
  },
};

export default nextConfig;
