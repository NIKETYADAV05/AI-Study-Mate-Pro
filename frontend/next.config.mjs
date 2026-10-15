/** @type {import('next').NextConfig} */
const nextConfig = {
  cacheComponents: true,
  partialPrefetching: true,

  // Stop Next.js from issuing 308 redirects to add/remove trailing slashes.
  // Without this, POST /api/summarize/ → 308 → GET /api/summarize (body lost).
  trailingSlash: false,

  async rewrites() {
    return [
      // Forward every /api/... request to Django, appending a trailing slash
      // because Django's URL dispatcher requires it.
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8000/api/:path*/",
      },
    ];
  },
};

export default nextConfig;
