# Deploying Enveloppe (Vultr, Toronto)

One VM runs everything: the app (Next.js standalone, non-root), Postgres (not exposed), and Caddy
(automatic HTTPS). About 20 minutes the first time.

## 1. Create the server
1. Vultr → **Deploy** → **Cloud Compute (Shared CPU)** → Location **Toronto** → **Ubuntu 24.04**
   → 2 vCPU / 4 GB → add your SSH key → Deploy.
2. Firewall group: allow **22** (your IP only), **80**, **443**. Nothing else.
3. A hostname for HTTPS, either:
   - your domain: add an **A record** → the server's IP at your registrar (e.g. Porkbun: Domain Management → DNS;
     delete its parking records for that host first), or
   - no DNS needed: `<ip-with-dashes>.sslip.io` (e.g. `149-28-10-20.sslip.io` for 149.28.10.20).

## 2. Install and start
```bash
ssh root@<server-ip>
curl -fsSL https://get.docker.com | sh
git clone https://github.com/MohamadHalalGithA/Enveloppe.git && cd Enveloppe
cp .env.production.example .env.production && nano .env.production   # fill every value (see below)
chmod 600 .env.production
echo "alias dc='docker compose --env-file .env.production -f docker-compose.prod.yml'" >> ~/.bashrc && . ~/.bashrc
dc up -d --build        # first build takes a few minutes
```
Every compose command needs the env file (the compose file refuses to run without `POSTGRES_PASSWORD`), so
the commands below use the `dc` alias. Run them from the `Enveloppe` folder.
`.env.production`:
- `DOMAIN` = the hostname; `APP_BASE_URL` = `https://<DOMAIN>`
- `POSTGRES_PASSWORD`, `REF_HMAC_KEY`, `AUTH0_SECRET`: new random values (`openssl rand -hex 32`).
  Keep `REF_HMAC_KEY` stable once real cases exist.
- Gemini / ElevenLabs keys (ElevenLabs key restricted to text-to-speech).
- `DEMO_MODE=off` normally; `fallback` only for a demo.

## 3. Auth0 (production)
In the Auth0 dashboard, preferably a **separate Regular Web Application** for production (separate secret):
- Allowed Callback URLs: `https://<DOMAIN>/auth/callback`
- Allowed Logout URLs: `https://<DOMAIN>`
- Allowed Web Origins: `https://<DOMAIN>`

Put its domain / client id / client secret in `.env.production`, then
`dc up -d` to apply.

## 4. Check it
```bash
curl -sI https://<DOMAIN>/demo | grep -iE "content-security-policy|strict-transport|x-frame"
# from your laptop, the full browser suite against the server:
E2E_BASE_URL=https://<DOMAIN> npx playwright test
```
Then sign in at `https://<DOMAIN>/app`, upload `demo/letters/out/A_cra_ccb_review.png`.

## Demo day
```bash
# on the server — reset the demo account and seed the 2023 reassessment case (no Gemini call):
dc run --rm tools \
  npm run demo:reset -- --sub "auth0|<demo user id from Auth0 → Users>"
```
Set `DEMO_MODE=fallback` for the demo: if Gemini is slow or down, uploads of the sample files use their
saved readings, badged "Cached reading". `DEMO_MODE=offline` skips Gemini entirely for those files.

## Operations
- Logs: `dc logs -f app` (ids, status and timing only; no letter content). HTTPS certificate: `dc logs -f caddy`.
- Backup: `dc exec db pg_dump -U enveloppe enveloppe > backup-$(date +%F).sql`
- Update: `git pull && dc up -d --build`
  (migrations apply automatically on start).
- Rotate a leaked key: replace it in `.env.production`, `up -d`, and revoke the old one at the provider.
