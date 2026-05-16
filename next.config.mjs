/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  experimental: {
    // We use server actions extensively for onboarding flows.
    serverActions: {
      bodySizeLimit: "12mb", // resume uploads
    },
  },
  // Don't bundle these on the server (they pull native modules).
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;
