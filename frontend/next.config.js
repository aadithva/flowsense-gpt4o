/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@interactive-flow/shared'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.blob.core.windows.net',
      },
    ],
  },
};

module.exports = nextConfig;
