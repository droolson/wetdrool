import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@wetdrool/ui', '@wetdrool/middle-out-lite', '@wetdrool/mesh'],
};

export default nextConfig;
