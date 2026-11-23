# GitHub Gist sync service

The static app does not contain a GitHub secret. This Cloudflare Worker performs GitHub OAuth and proxies only private schedule-Gist operations. GitHub access tokens are stored in the Worker KV namespace; the browser receives a separate, revocable session credential.

## One-time setup

1. Create a Cloudflare Workers KV namespace named `SESSIONS`. Put its ID in `worker/wrangler.toml`. Set `APP_URL` to the exact deployed app URL, including its repository path. The current app URL and namespace ID are already configured in this repository.

2. Create a Cloudflare API token scoped only to this account, with:
   - Account Settings: Read
   - Workers Scripts: Edit
   - Workers KV Storage: Edit

   Save it in the GitHub repository as the Actions secret `CLOUDFLARE_API_TOKEN`. Also add the Cloudflare account ID as the Actions variable `CLOUDFLARE_ACCOUNT_ID`. Do not commit either value. The workflow at `.github/workflows/deploy-cloudflare-worker.yml` deploys changes from the `worker/` directory to the `main` branch.

3. After the first successful Worker deployment, create a GitHub OAuth App. Set its callback URL to the deployed Worker URL plus `/auth/callback`, for example `https://fs-conductors-gist-sync.<account>.workers.dev/auth/callback`. Use the app's public URL as its homepage. The Worker requests only the `gist` scope.

4. Put the OAuth app's client ID in `worker/wrangler.toml` as `GITHUB_CLIENT_ID` and push the change to deploy it. In the Cloudflare Worker dashboard, add `GITHUB_CLIENT_SECRET` as a secret.

5. Generate a 32-byte encryption key locally with `openssl rand -hex 32` and add the resulting 64-character hexadecimal value as the Worker secret `SESSION_ENCRYPTION_KEY`. Never commit either Worker secret.

6. Put the deployed Worker origin (no trailing slash) in `js/deployment-config.js` as `gistApiBaseUrl`, then publish the static app.

The Worker URL and OAuth client ID are public configuration, not secrets. Never put `GITHUB_CLIENT_SECRET`, `SESSION_ENCRYPTION_KEY`, or `CLOUDFLARE_API_TOKEN` in the static app or repository.

## Syncing devices

Sign in to GitHub from each device. Create a private Gist on the first device, then share only its Gist ID with other devices. The Worker checks Gist ownership and privacy before allowing reads or writes. Browser session credentials are stored in IndexedDB and can be revoked from the app with **Disconnect**; server-side sessions expire after 30 days.

To revoke previously created personal access tokens, visit GitHub **Settings → Developer settings → Personal access tokens**. Older app versions stored PATs in local storage; v50 removes the legacy token from sync settings during startup.
