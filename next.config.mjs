/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // CI/local verification can use NEXT_DIST_DIR=.next-build without colliding
  // with a running development server's .next cache.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Lock Turbopack to this project when other package manifests exist nearby.
  turbopack: { root: process.cwd() },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "ddcpersia.com" },
      { protocol: "https", hostname: "www.ddcpersia.com" },
    ],
  },
  allowedDevOrigins: [
    "192.168.1.5",
    "192.168.1.3",
    "172.18.0.1",
    "localhost",
    "127.0.0.1",
  ],
};

export default nextConfig;
