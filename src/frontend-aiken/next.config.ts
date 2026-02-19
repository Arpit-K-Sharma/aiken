import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {},
  webpack: (config, { isServer }) => {
    // Support for WebAssembly
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Support for JSON imports
    config.module.rules.push({
      test: /\.json$/,
      type: 'json',
    });

    // Handle WASM files
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });

    // Only set fallbacks for client build, not server
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    } else {
      // Ensure no fallbacks are set for server build
      if (config.resolve.fallback) {
        delete config.resolve.fallback.fs;
        delete config.resolve.fallback.net;
        delete config.resolve.fallback.tls;
      }
    }

    return config;
  },
  serverExternalPackages: ['@sidan-lab/whisky-js-nodejs'],
};

export default nextConfig;
