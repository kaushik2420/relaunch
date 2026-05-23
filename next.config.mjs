/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // We use server actions extensively for onboarding flows.
    serverActions: {
      bodySizeLimit: '12mb', // resume uploads
    },
    // Native deps that should NOT be bundled on the server.
    serverComponentsExternalPackages: ['pdf-parse', 'mammoth', '@react-pdf/renderer'],
    // Don't reuse a cached client-side render of dynamic pages — after a
    // save, navigating back must always re-fetch fresh data from the server.
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
