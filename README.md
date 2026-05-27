# 🩳 Shorts

Embedded Circles miniapp where users publish short movies and pay CRC to interact.

## Rules

| Action | Cost | Recipient |
|--------|------|-----------|
| Publish a short | **1 CRC** (or reputation-based) | Platform organisation (`VITE_PLATFORM_ORG_ADDRESS`) |
| Flag a short | **0.5 CRC** | Platform organisation (`VITE_PLATFORM_ORG_ADDRESS`) |
| Upvote a short | **0.5 CRC** | The short's creator |
| Comment on a short | **0.5 CRC** | The short's creator |

Platform fees go to a **Circles organisation avatar**. Set `VITE_PLATFORM_ORG_ADDRESS` in `.env` before `npm run build` / deploy. Default if unset: `0x507F542f14F55315F96aD1D454859EaA5c9E1923`.

### Register the platform organisation

Use a **dedicated Safe** for the treasury — not your personal Circles human wallet (one address = one avatar type).

1. **Create a Safe** at [app.safe.global](https://app.safe.global) on Gnosis Chain. Fund it with a little **xDAI** (~0.01) for gas.
2. **Export one owner private key** for that Safe (Settings → owner key export, or use a fresh EOA you added as sole owner when creating the Safe).
3. Add to `.env` (never commit real keys):
   ```
   ORG_REGISTER_PRIVATE_KEY=0x...
   ORG_SAFE_ADDRESS=0x...          # the Safe address
   ORG_NAME=Shorts
   ORG_DESCRIPTION=Platform treasury for Shorts
   ```
4. Register on Circles:
   ```bash
   npm run register:org
   ```
   This runs the same flow as the [Circles SDK docs](https://docs.aboutcircles.com/circles-sdk/circles-avatars/organization-avatars/creation-of-organizations): `Sdk` + `register.asOrganization`, with a Safe runner for signing.
5. Copy the printed address into `.env`:
   ```
   VITE_PLATFORM_ORG_ADDRESS=0x...
   ```
6. Rebuild and deploy:
   ```bash
   npm run deploy
   ```

Docs: [Creation of Organizations](https://docs.aboutcircles.com/circles-sdk/circles-avatars/organization-avatars/creation-of-organizations)

A short requires a title, at least 1 genre, and an HTTPS video link (YouTube, Vimeo, TikTok, Twitch, Streamable, Dailymotion). The list view embeds the video preview, and supports search by title, multi-genre filter, and sorting by most recent, most upvotes, or most comments.

## Develop (UI only)

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. Wallet/CRC requires the Circles host iframe.

## Develop (host + hot reload)

Chrome blocks a public HTTPS host from loading `http://localhost:5173`. Use a tunnel.

```bash
brew install cloudflared
npm run tunnel
```

Copy the HTTPS tunnel hostname into `.env`:

```
VITE_HMR_HOST=your-subdomain.trycloudflare.com
```

Restart `npm run dev`, then register the full `https://…trycloudflare.com` URL as the miniapp URL in the Circles host.

**Tunnel troubleshooting**

`failed to parse quick Tunnel ID: invalid UUID length: 0` means `cloudflared` got an empty or invalid response from `api.trycloudflare.com` (often intermittent on Cloudflare’s side, or blocked by VPN/ad blocker/corporate network).

1. Start the dev server first: `npm run dev` (tunnel must point at a running port).
2. In a second terminal: `npm run tunnel` (or `cloudflared tunnel --url http://127.0.0.1:5173`).
3. Update cloudflared: `brew upgrade cloudflared`.
4. Retry in a few minutes, or disable VPN/ad blockers for `trycloudflare.com`.
5. **Skip the tunnel** for host testing: use the deployed app at `https://circles-shorts.pages.dev` instead of localhost.

**Alternatives if quick tunnels keep failing**

- **ngrok**: `ngrok http 5173` → set `VITE_HMR_HOST` to the ngrok hostname (no `https://`).
- **Named Cloudflare tunnel** (stable, needs free Cloudflare account): [Cloudflare Tunnel setup](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/).

## Demo without funds

Set `VITE_DEMO_NO_CRC=true` in `.env` to skip CRC transfers (shorts/comments/upvotes still save locally). Useful when the connected wallet has no CRC or the path-finder cannot find a path.

## Storage / data model

- **Local cache**: `src/data/storage.js` keeps a `localStorage`-backed copy of every short, comment, and upvote the browser has seen. The UI renders from this cache.
- **Content layer (IPFS via Pinata)**: every publish, comment, and upvote pins a JSON payload through `src/data/ipfs.js`. Each pin carries `keyvalues = { app: 'shorts', kind: 'short' | 'comment' | 'upvote', shortCid?, creator?, voter?, author? }` so the app can re-discover them later. Legacy pins tagged `circles-shorts` are still synced.
- **Discovery**: `src/data/feed.js#refreshFeedFromRemote` calls Pinata's `pinList` endpoint to enumerate all shorts/comments/upvotes for the app, fetches each by CID through public IPFS gateways, and upserts the results into local storage. Runs on boot, on tab focus, on wallet change, and every minute.
- **On-chain anchor (Circles V2 `transferData`)**: every CRC transfer carries the matching CID encoded with `encodeCrcV2TransferData([cid], 0x0003)` from `@aboutcircles/sdk-utils`. Any observer can decode a transaction's `transferData`, fetch the CID from IPFS, and verify what the user paid for.

## Deploy to Cloudflare Pages (recommended)

The app is a pure static bundle. We deploy via Cloudflare Pages because it's free, fast, and (unlike Pinata's public gateway on the free tier) serves HTML.

One-time setup:

```bash
npx wrangler login
```

This opens a browser tab — allow access for the CLI. Done once per machine.

Deploy:

```bash
npm run deploy
```

This runs `npm run build` and then `wrangler pages deploy dist --project-name=circles-shorts`. Subsequent runs push a new version. Stable URL: `https://circles-shorts.pages.dev` (plus a unique preview URL per deploy). The slug `shorts.pages.dev` is taken by another project on Cloudflare.

Paste the stable URL into the Circles miniapp host. The `VITE_PINATA_JWT` is inlined into the JS bundle at build time, so no extra Cloudflare env config is needed.

## Deploy to Pinata IPFS (alternative)

If you have a paid Pinata gateway or want a fully decentralized host:

```bash
npm run deploy:pinata
```

Prints a gateway URL like `https://gateway.pinata.cloud/ipfs/bafy…/`. Note: Pinata's *public* gateway blocks HTML on free plans (error `00023`). To use this path you need a dedicated gateway (Pinata dashboard → Gateways), then set `VITE_IPFS_GATEWAY=https://<your>.mypinata.cloud` so the script prints that URL instead.

For a stable URL across IPFS deploys, point either:
- an ENS name's contenthash at the latest CID, or
- a Pinata dedicated gateway's DNSLink at the latest CID.

## Structure

```
src/
  app/      state, actions, ui
  chain/    circlesTransfer.js (TransferBuilder -> sendTransactions, CID -> transferData)
  data/     ipfs.js (Pinata pin/list), feed.js (cross-user aggregator), storage.js (local cache)
  host/     bridge.js (sendTransactions adapter)
  utils/    format.js, validation.js
  main.js
scripts/
  deploy-pinata.mjs (pin dist/ to Pinata as an alternative host)
```

## Environment

| Variable | Purpose |
|----------|---------|
| `VITE_PINATA_JWT` | Pinata API JWT (scope: `pinJSONToIPFS`, `pinFileToIPFS`, `pinList`). Required for cross-user feed + deploy. |
| `VITE_PLATFORM_ORG_ADDRESS` | Circles **organisation** avatar that receives publish + flag fees. Inlined at build time. |
| `VITE_IPFS_GATEWAY` | Optional dedicated Pinata gateway URL (faster reads). |
| `VITE_HMR_HOST` | Tunnel hostname for HMR in the Circles host. |
| `VITE_CIRCLES_RPC_URL` | Public HTTPS Circles RPC (fallback to the one host provides via `onAppData`, else `https://rpc.aboutcircles.com/`). |
| `VITE_DEMO_NO_CRC` | `true` to skip CRC transfers (local-only). |
| `VITE_PROFILE_URL_TEMPLATE` | Profile link template; `{address}` replaced with avatar address. |

## Security notes

The Pinata JWT ships to the browser, so anyone using the deployed app can use the quota. Mitigations:

- Scope the key to `pinJSONToIPFS` + `pinFileToIPFS` + `pinList` only (no unpin).
- Set a tight monthly limit on the Pinata key.
- For production: front Pinata with a Cloudflare Worker / Vercel Edge function holding the JWT server-side, and have the app POST to your worker instead.
