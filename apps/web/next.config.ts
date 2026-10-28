import type { NextConfig } from "next";

// Section photos and logos are served from Supabase Storage's public org-assets bucket.
const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321");

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // With Turbopack's dev cache on, every dev-server restart left the browser in a reload loop (the server sent
    // "restart" for the entry chunk list on each connect). A cold compile on restart is the smaller cost.
    turbopackFileSystemCacheForDev: false,
  },
  images: {
    remotePatterns: [new URL(`${supabase.origin}/storage/v1/object/public/org-assets/**`)],
    // The local Supabase runs on 127.0.0.1, which Next won't fetch images from unless told; the hosted one isn't local.
    dangerouslyAllowLocalIP: ["127.0.0.1", "localhost"].includes(supabase.hostname),
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
