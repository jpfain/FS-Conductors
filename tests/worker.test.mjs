import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.mjs";

function createEnv() {
  const values = new Map();
  return {
    APP_URL: "https://example.test/FS-Conductors/",
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "server-only-secret",
    SESSION_ENCRYPTION_KEY: "a".repeat(64),
    SESSIONS: {
      async get(key) { return values.get(key) || null; },
      async put(key, value) { values.set(key, value); },
      async delete(key) { values.delete(key); }
    }
  };
}

test("sync API refuses unauthenticated requests", async () => {
  const response = await worker.fetch(
    new Request("https://sync.example.workers.dev/api/session", {
      headers: { Origin: "https://example.test" }
    }),
    createEnv()
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://example.test");
});

test("sync API refuses requests from other origins", async () => {
  const response = await worker.fetch(
    new Request("https://sync.example.workers.dev/api/session", {
      headers: { Origin: "https://attacker.example" }
    }),
    createEnv()
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("preflight is allowed only for the configured app origin", async () => {
  const env = createEnv();
  const allowed = await worker.fetch(
    new Request("https://sync.example.workers.dev/api/gists", {
      method: "OPTIONS",
      headers: { Origin: "https://example.test" }
    }),
    env
  );
  const denied = await worker.fetch(
    new Request("https://sync.example.workers.dev/api/gists", {
      method: "OPTIONS",
      headers: { Origin: "https://other.example" }
    }),
    env
  );

  assert.equal(allowed.status, 204);
  assert.equal(denied.status, 403);
});
