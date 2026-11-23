const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_STATE_TTL_SECONDS = 5 * 60;
const OAUTH_TICKET_TTL_SECONDS = 60;
const MAX_GIST_PAYLOAD_BYTES = 1_000_000;
const GIST_FILENAME = "conductor-schedule-data.json";

function jsonResponse(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}

function allowedOrigin(request, env) {
  try {
    const app = new URL(env.APP_URL);
    return request.headers.get("Origin") === app.origin ? app.origin : "";
  } catch {
    return "";
  }
}

function requireConfiguration(env) {
  if (!env.APP_URL || !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET ||
      !env.SESSION_ENCRYPTION_KEY || !env.SESSIONS) {
    throw new Error("OAuth service is missing required configuration.");
  }
  const appUrl = new URL(env.APP_URL);
  if (appUrl.protocol !== "https:" || appUrl.search || appUrl.hash) {
    throw new Error("APP_URL must be an HTTPS URL without query or fragment.");
  }
}

function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function encryptionKeyBytes(env) {
  if (!/^[a-f0-9]{64}$/i.test(env.SESSION_ENCRYPTION_KEY || "")) {
    throw new Error("OAuth service encryption key is missing or invalid.");
  }
  return Uint8Array.from(env.SESSION_ENCRYPTION_KEY.match(/.{2}/g), byte => parseInt(byte, 16));
}

async function encryptToken(token, env) {
  const key = await crypto.subtle.importKey("raw", encryptionKeyBytes(env), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  const bytes = new Uint8Array(ciphertext);
  return `${Array.from(iv, byte => byte.toString(16).padStart(2, "0")).join("")}.${btoa(String.fromCharCode(...bytes))}`;
}

async function decryptToken(value, env) {
  const [ivHex, encoded] = String(value || "").split(".");
  if (!/^[a-f0-9]{24}$/i.test(ivHex || "") || !encoded) throw new Error("Encrypted session token is invalid.");
  const iv = Uint8Array.from(ivHex.match(/.{2}/g), byte => parseInt(byte, 16));
  const ciphertext = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", encryptionKeyBytes(env), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function requireSession(request, env) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer ([A-Fa-f0-9]{64})$/);
  if (!match) return null;
  const key = await hashToken(match[1]);
  const raw = await env.SESSIONS.get(`session:${key}`);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return { key, token: match[1], value, githubToken: await decryptToken(value.githubTokenEncrypted, env) };
  } catch {
    await env.SESSIONS.delete(`session:${key}`);
    return null;
  }
}

async function githubRequest(path, token, options = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "FS-Conductors-PWA",
      ...(options.headers || {})
    }
  });
}

function validGistPayload(payload, creating = false) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      !payload.files || typeof payload.files !== "object" || Array.isArray(payload.files)) return false;
  const file = payload.files[GIST_FILENAME];
  if (!file || typeof file.content !== "string" ||
      new TextEncoder().encode(file.content).byteLength > MAX_GIST_PAYLOAD_BYTES) return false;
  try {
    const schedule = JSON.parse(file.content);
    if (!schedule || !Array.isArray(schedule.roster)) return false;
  } catch {
    return false;
  }
  if (creating && payload.public !== false) return false;
  return Object.keys(payload.files).length === 1;
}

async function authorizePrivateGist(id, session, env) {
  const response = await githubRequest(`/gists/${encodeURIComponent(id)}`, session.githubToken);
  if (!response.ok) return { response, gist: null };
  const gist = await response.json();
  if (gist.id !== id || gist.public !== false || gist.owner?.login !== session.value.user) {
    return { response: jsonResponse({ error: "Gist is not a private Gist owned by this GitHub account." }, 403), gist: null };
  }
  if (!session.value.gistIds.includes(id)) {
    session.value.gistIds.push(id);
    if (session.value.gistIds.length > 10) {
      return { response: jsonResponse({ error: "This account has reached the connected Gist limit." }, 400), gist: null };
    }
    await env.SESSIONS.put(`session:${session.key}`, JSON.stringify(session.value), {
      expirationTtl: SESSION_TTL_SECONDS
    });
  }
  return { response, gist };
}

async function oauthCallback(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const stateCookie = (request.headers.get("Cookie") || "")
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith("oauth_state="))
    ?.slice("oauth_state=".length);
  if (!state || !code || !stateCookie || stateCookie !== state) {
    return new Response("GitHub sign-in was cancelled, expired, or failed state validation.", { status: 400 });
  }

  const stateKey = `oauth-state:${state}`;
  const stateValue = await env.SESSIONS.get(stateKey);
  await env.SESSIONS.delete(stateKey);
  if (!stateValue) return new Response("GitHub sign-in expired. Return to the app and try again.", { status: 400 });

  const callbackUrl = `${url.origin}/auth/callback`;
  const exchange = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl
    })
  });
  if (!exchange.ok) return new Response("Could not complete GitHub sign-in.", { status: 502 });
  const tokenResult = await exchange.json();
  if (!tokenResult.access_token || tokenResult.error) {
    return new Response("GitHub did not authorize this app.", { status: 401 });
  }

  const userResponse = await githubRequest("/user", tokenResult.access_token);
  if (!userResponse.ok) return new Response("Could not verify the GitHub account.", { status: 502 });
  const user = await userResponse.json();
  const sessionId = randomToken();
  await env.SESSIONS.put(`oauth-session:${sessionId}`, JSON.stringify({
    githubTokenEncrypted: await encryptToken(tokenResult.access_token, env),
    user: user.login,
    gistIds: []
  }), { expirationTtl: OAUTH_TICKET_TTL_SECONDS });

  const ticket = randomToken();
  await env.SESSIONS.put(`oauth-ticket:${ticket}`, sessionId, {
    expirationTtl: OAUTH_TICKET_TTL_SECONDS
  });
  const appUrl = new URL(env.APP_URL);
  appUrl.hash = new URLSearchParams({ oauth_ticket: ticket }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      "Location": appUrl.toString(),
      "Set-Cookie": "oauth_state=; Path=/auth/callback; Max-Age=0; Secure; HttpOnly; SameSite=Lax"
    }
  });
}

async function route(request, env) {
  requireConfiguration(env);
  const url = new URL(request.url);
  const origin = allowedOrigin(request, env);

  if (request.method === "OPTIONS") {
    if (!origin) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (url.pathname === "/auth/login" && request.method === "GET") {
    const state = randomToken();
    await env.SESSIONS.put(`oauth-state:${state}`, "started", {
      expirationTtl: OAUTH_STATE_TTL_SECONDS
    });
    const callbackUrl = `${url.origin}/auth/callback`;
    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
    authorizeUrl.searchParams.set("scope", "gist");
    authorizeUrl.searchParams.set("state", state);
    return new Response(null, {
      status: 302,
      headers: {
        "Location": authorizeUrl.toString(),
        "Set-Cookie": `oauth_state=${state}; Path=/auth/callback; Max-Age=${OAUTH_STATE_TTL_SECONDS}; Secure; HttpOnly; SameSite=Lax`
      }
    });
  }

  if (url.pathname === "/auth/callback" && request.method === "GET") {
    return oauthCallback(request, env);
  }

  if (!origin) return jsonResponse({ error: "Request origin is not allowed." }, 403);
  const cors = corsHeaders(origin);

  if (url.pathname === "/auth/exchange" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const ticket = typeof body?.ticket === "string" ? body.ticket : "";
    if (!/^[a-f0-9]{64}$/i.test(ticket)) return jsonResponse({ error: "Invalid or expired sign-in ticket." }, 400, cors);
    const ticketKey = `oauth-ticket:${ticket}`;
    const sessionId = await env.SESSIONS.get(ticketKey);
    await env.SESSIONS.delete(ticketKey);
    if (!sessionId) return jsonResponse({ error: "Invalid or expired sign-in ticket." }, 401, cors);
    const oauthSessionKey = `oauth-session:${sessionId}`;
    const oauthSession = await env.SESSIONS.get(oauthSessionKey);
    await env.SESSIONS.delete(oauthSessionKey);
    if (!oauthSession) return jsonResponse({ error: "Sign-in session expired. Please reconnect." }, 401, cors);
    const sessionValue = JSON.parse(oauthSession);
    const sessionToken = randomToken();
    await env.SESSIONS.put(`session:${await hashToken(sessionToken)}`, JSON.stringify(sessionValue), {
      expirationTtl: SESSION_TTL_SECONDS
    });
    return jsonResponse({ sessionToken, user: sessionValue.user }, 200, cors);
  }

  if (url.pathname === "/auth/logout" && request.method === "POST") {
    const session = await requireSession(request, env);
    if (session) await env.SESSIONS.delete(`session:${session.key}`);
    return jsonResponse({ ok: true }, 200, cors);
  }

  const session = await requireSession(request, env);
  if (!session) return jsonResponse({ error: "GitHub session is missing or expired. Reconnect your account." }, 401, cors);

  if (url.pathname === "/api/session" && request.method === "GET") {
    return jsonResponse({ user: session.value.user, gistIds: session.value.gistIds }, 200, cors);
  }

  if (url.pathname === "/api/gists" && request.method === "POST") {
    if (session.value.gistIds.length >= 10) {
      return jsonResponse({ error: "This account has reached the connected Gist limit." }, 400, cors);
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_GIST_PAYLOAD_BYTES + 5000) {
      return jsonResponse({ error: "Gist payload is too large." }, 413, cors);
    }
    let payload;
    try { payload = JSON.parse(text); } catch {
      return jsonResponse({ error: "Gist payload is not valid JSON." }, 400, cors);
    }
    if (!validGistPayload(payload, true)) {
      return jsonResponse({ error: "Only a private schedule Gist with a valid schedule file can be created." }, 400, cors);
    }
    const response = await githubRequest("/gists", session.githubToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Conductor Schedule PWA Sync Data", public: false, files: payload.files })
    });
    if (!response.ok) return jsonResponse({ error: "GitHub could not create the private schedule Gist." }, response.status, cors);
    const gist = await response.json();
    session.value.gistIds.push(gist.id);
    await env.SESSIONS.put(`session:${session.key}`, JSON.stringify(session.value), {
      expirationTtl: SESSION_TTL_SECONDS
    });
    return jsonResponse(gist, 201, cors);
  }

  const gistMatch = url.pathname.match(/^\/api\/gists\/([a-f0-9]{20,40})$/i);
  if (gistMatch && ["GET", "PATCH"].includes(request.method)) {
    const gistId = gistMatch[1];
    if (request.method === "PATCH") {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > MAX_GIST_PAYLOAD_BYTES + 5000) {
        return jsonResponse({ error: "Gist payload is too large." }, 413, cors);
      }
      let payload;
      try { payload = JSON.parse(text); } catch {
        return jsonResponse({ error: "Gist payload is not valid JSON." }, 400, cors);
      }
      if (!validGistPayload(payload)) {
        return jsonResponse({ error: "Only a valid conductor schedule file can be written." }, 400, cors);
      }
      const authorization = await authorizePrivateGist(gistId, session, env);
      if (!authorization.gist) {
        return jsonResponse({ error: "The private Gist could not be verified for this GitHub account." }, authorization.response.status, cors);
      }
      const response = await githubRequest(`/gists/${encodeURIComponent(gistId)}`, session.githubToken, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payload.files })
      });
      if (!response.ok) return jsonResponse({ error: "GitHub could not update the schedule Gist." }, response.status, cors);
      return jsonResponse(await response.json(), 200, cors);
    }

    const authorization = await authorizePrivateGist(gistId, session, env);
    if (!authorization.gist) {
      return jsonResponse({ error: "The private Gist could not be verified for this GitHub account." }, authorization.response.status, cors);
    }
    if (request.method === "GET") return jsonResponse(authorization.gist, 200, cors);
  }

  return jsonResponse({ error: "Not found." }, 404, cors);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      const origin = allowedOrigin(request, env);
      return jsonResponse(
        { error: error.message || "Cloud sync request failed." },
        500,
        origin ? corsHeaders(origin) : {}
      );
    }
  }
};
