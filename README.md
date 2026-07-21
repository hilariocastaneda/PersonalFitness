# Fromesco

A personal Profile / Fitness / Fashion PWA, self-hosted on the home Debian server (ARM-64, `192.168.100.160`). Project/folder name and product are both **Fromesco**.

## Access

**URL:** https://192.168.100.160:8446

- Uses a cert issued by a local `mkcert` CA (same cert file PhotoVault uses) — **install the root CA once per device** so both the browser and OS fully trust it: visit `https://192.168.100.160:8446/ca.crt`, install the profile/certificate, and (iOS only) enable full trust for it under Settings → General → About → Certificate Trust Settings. See [Certificates](#certificates) below for why this matters and full per-OS steps.
- Pick your user, enter your PIN.
- After PIN setup, you'll be walked through the Profile onboarding wizard before the Dashboard unlocks.
- Installable as a PWA (Add to Home Screen / desktop install icon) — works on mobile and desktop, zoom is locked so it feels native.

## Modules

- **Profile** — a 4-step onboarding wizard: body/measurements, health, lifestyle, goals. Shared source of truth for the other two modules.
- **Fitness** — real exercise library (25 exercises with photos + instructions), home-workout-only filter, auto-generated weekly plan, workout history log, and a tap-through exercise detail view (photo, instructions, muscle group/equipment tags, embedded video if a YouTube link is set).
  - **Admin → Workout Maintenance**: add/edit/delete exercises, upload a reference photo, set a video URL, tag "Home Workout."
- **Fashion** — wardrobe tracker with photo upload, color/style recommendations based on complexion & body shape, wardrobe gap detection, size guide, and three AI-powered features (see below).
- **Settings** — units toggle (metric/imperial), PIN change, your own Anthropic API key (BYOK, for the AI features), and an admin panel (add users, grant/revoke admin, link to Workout Maintenance).

### AI features (bring your own Anthropic API key, set in Settings)

- **Wardrobe scoring** — every uploaded item automatically gets a 1–5 score + one-line reasoning against your complexion/body shape.
- **Outfit Check** — upload a photo of yourself in an outfit, get specific AI feedback (fit, color coordination, one concrete suggestion).
- **Generate Outfit** — describe what you need it for; AI picks a coherent outfit from your existing wardrobe with reasoning.

All three are silently disabled until an API key is set — no key, no AI calls, no errors.

## Architecture

Modeled directly on the PhotoVault app already running on this box — no build step, no framework:

- `info.json` (repo root) — the single database: all users, their profile/fitness/fashion data (including wardrobe photos, AI scores, generated outfits), and the shared exercise library. Auto-created and self-migrating on server start.
- `server/server.js` — one Express file. Plaintext PIN auth (`X-User-Name` header), matching PhotoVault's LAN-trust auth model. Uses `multer` for photo uploads and `@anthropic-ai/sdk` for the AI features (BYOK — each user's key is used per-request, never shared).
- `client/index.html` — one static file (inline CSS/JS), plus `manifest.json` + `sw.js` for PWA installability.
- `client/exercise-images/` — reference photos for the seeded exercise library (sourced from the free-exercise-db dataset) plus any admin-uploaded exercise images.
- `client/uploads/` — user-uploaded wardrobe and outfit-check photos.

### Deployment

| | |
|---|---|
| Backend service | `fromesco.service` (systemd, runs as `www-data`, port 3003) |
| Nginx site | `/etc/nginx/sites-available/fromesco` (port 8446 SSL, `client_max_body_size 10M` for photo uploads) |
| Static root | `client/` served directly from this share |
| Data file | `info.json` at repo root |
| Path | `/mnt/disk1/system/Fromesco` (SMB share `CSTMEDIA A`, mapped as `Z:\system\Fromesco`) |

Common ops (via `ssh rjay@192.168.100.160`):

```bash
# restart backend after editing server.js
sudo systemctl restart fromesco

# tail logs
sudo journalctl -u fromesco -f

# after editing nginx config
sudo nginx -t && sudo systemctl reload nginx
```

Since this folder is the SMB share backing the server, editing files here (client or server) takes effect immediately for static files; server-side changes need a `systemctl restart fromesco` to take effect.

**Note:** the underlying disk (`/mnt/disk1`) is exFAT, which doesn't support symlinks — always run `npm install --no-bin-links` in `server/` if dependencies change.

### Certificates

`/etc/nginx/ssl/server.crt` + `server.key` are issued by a local `mkcert` CA (installed via `apt`), not self-signed — this is shared between Fromesco (8446) and PhotoVault (8445). Self-signed certs that are only "clicked through" in-browser (never OS-trusted) actively break PWA icon delivery: iOS Safari won't use `apple-touch-icon` at all against an untrusted cert (plain HTTP is actually fine for this — it's specifically self-signed HTTPS that's the trap), and Android Chrome's WebAPK minting (what gives an installed PWA a real home-screen icon instead of a plain bookmark) also requires a trusted chain. Dropping to HTTP isn't a fix either: Android's installability criteria hard-require HTTPS, and service workers (used here for offline caching + auto-update) refuse to run outside a secure context at all.

The CA root (`~/.local/share/mkcert/rootCA.pem` on the server, private key never leaves the box) is served read-only at `/ca.crt` on the Fromesco site for per-device install:

- **iOS:** visit `https://192.168.100.160:8446/ca.crt` in Safari → Allow → install the downloaded profile (Settings → *Profile Downloaded*, enter passcode, Install again to confirm) → then **Settings → General → About → Certificate Trust Settings** → toggle full trust on for the mkcert CA. Without this last step the profile installs but isn't actually trusted for TLS.
- **Android:** visit the same URL in Chrome → download the `.crt` → Settings → Security → Encryption & credentials → Install a certificate → CA certificate → select the downloaded file. Android will show a generic "network may be monitored" warning for any custom CA — expected and safe here, it's a CA you generated yourself for this one box.

Do this once per device (yours, family members'). After installing, **remove and re-add any existing home-screen icon** for the app — both iOS and Android cache whatever icon they captured on first install and won't refetch it just because the cert changed.

Leaf cert expires 2028-10-21; regenerate with `mkcert -cert-file /etc/nginx/ssl/server.crt -key-file /etc/nginx/ssl/server.key 192.168.100.160` (as `rjay`, then `sudo` the files into place) and `sudo systemctl reload nginx`. The original self-signed cert is kept at `server.crt.selfsigned-bak` / `server.key.selfsigned-bak` for rollback.
