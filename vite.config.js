import { defineConfig, loadEnv } from 'vite';

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
  };
});
