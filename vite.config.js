import { defineConfig, loadEnv } from 'vite';
import { fetchYoutubeDurationInnertube } from './lib/youtubeInnertubeDuration.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const hmrHost = env.VITE_HMR_HOST?.trim();

  return {
    // Use relative asset paths so the built bundle works under any URL prefix
    // (Pinata gateway: https://gateway.pinata.cloud/ipfs/<CID>/, ENS subdomain, etc.).
    base: './',
    server: {
      port: 5173,
      strictPort: true,
      host: true,
      proxy: {
        '/api/pinata': {
          target: 'https://api.pinata.cloud',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/pinata/, ''),
        },
      },
      // Allow tunnel hostnames (ngrok, Cloudflare, etc.)
      allowedHosts: hmrHost ? [hmrHost, '.trycloudflare.com', '.ngrok-free.app', '.ngrok.io'] : true,
      ...(hmrHost
        ? {
            hmr: {
              host: hmrHost,
              clientPort: 443,
              protocol: 'wss',
            },
          }
        : {}),
    },
    plugins: [
      {
        name: 'youtube-duration-api',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const m = req.url?.match(/^\/api\/(?:v2\/)?youtube-duration\/([\w-]{11})$/);
            if (!m) return next();
            try {
              const apiKey = env.YOUTUBE_API_KEY?.trim() || env.VITE_YOUTUBE_API_KEY?.trim() || '';
              const durationSeconds = await fetchYoutubeDurationInnertube(m[1], { apiKey });
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ durationSeconds }));
            } catch {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ durationSeconds: null }));
            }
          });
        },
      },
    ],
  };
});
