# GitHub Gist sync service

The static app does not contain a GitHub secret. This Cloudflare Worker performs GitHub OAuth and proxies only private schedule-Gist operations. GitHub access tokens are stored in the Worker KV namespace; the browser receives a separate, revocable session credential.

## One-time setup

1. Install and authenticate Wrangler with a Cloudflare account:

   ```sh
   npm install --global wrangler
   npx wrangler login
   ```

2. Create the KV namespace and copy its returned ID into `worker/wrangler.toml`:

   ```sh
   npx wrangler kv namespace create SESSIONS
   ```

3. Create a GitHub OAuth App. Set its callback URL to the Worker URL plus `/auth/callback`, for example `https://fs-conductors-gist-sync.<account>.workers.dev/auth/callback`. Use the app's public URL as its homepage. The Worker requests only the `gist` scope.

4. In `worker/wrangler.toml`, set `APP_URL` to the exact deployed app URL (including its repository path if using GitHub Pages) and set `GITHUB_CLIENT_ID`.

5. Add the OAuth client secret and a 32-byte encryption key as Worker secrets. Generate the encryption key locally; do not commit it:

   ```sh
   npx wrangler secret put GITHUB_CLIENT_SECRET
   openssl rand -hex 32
   npx wrangler secret put SESSION_ENCRYPTION_KEY
   npx wrangler deploy
   ```

   Paste the generated 64-character hexadecimal value when Wrangler prompts for `SESSION_ENCRYPTION_KEY`.

6. Put the deployed Worker origin (no trailing slash) in `js/deployment-config.js` as `gistApiBaseUrl`, then publish the static app.

The Worker URL is public configuration, not a secret. Never put `GITHUB_CLIENT_SECRET` in the static app or this repository. Do not commit populated secret values or Cloudflare credentials.

## Syncing devices

Sign in to GitHub from each device. Create a private Gist on the first device, then share only its Gist ID with other devices. The Worker checks Gist ownership and privacy before allowing reads or writes. Browser session credentials are stored in IndexedDB and can be revoked from the app with **Disconnect**; server-side sessions expire after 30 days.

To revoke previously created personal access tokens, visit GitHub **Settings → Developer settings → Personal access tokens**. Older app versions stored PATs in local storage; v50 removes the legacy token from sync settings during startup.
