/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@interactive-flow/shared'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
};

module.exports = nextConfig;
