/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@solana/wallet-adapter-base',
    '@solana/wallet-adapter-react',
    '@solana/wallet-adapter-react-ui',
    '@coral-xyz/anchor',
  ],
  turbopack: {},
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      crypto: false,
      stream: false,
      buffer: false,
      fs: false,
      path: false,
      os: false,
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/api/actions/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          {
            key: 'Access-Control-Allow-Headers',
            value:
              'Content-Type, Authorization, Content-Encoding, Accept-Encoding',
          },
          {
            key: 'Access-Control-Expose-Headers',
            value: 'X-Action-Version, X-Blockchain-Ids',
          },
          { key: 'X-Action-Version', value: '2.2' },
          {
            key: 'X-Blockchain-Ids',
            value: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
          },
        ],
      },
    ];
  },
}

module.exports = nextConfig
