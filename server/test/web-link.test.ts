import { describe, it, expect, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { AuthService } from "../src/services/auth-service.js";
import { WebLinkTokenService } from "../src/services/web-link-token-service.js";
import { buildApp } from "../src/index.js";
import { users } from "../src/schema.js";
import { migratedFileDb } from "./helpers/migrated-db.js";
import type { User } from "../src/models/user.js";

/**
 * Web-link auth grant (WI-WEB-1): mint a long-lived weblink token/URL for a known
 * user, and exchange it at POST /v1/users/sign_in for a normal session. Offline —
 * a local `file:` libSQL db, no network.
 */
let db: Database;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});
afterEach(() => cleanup());

/** Insert a user with a real ES256 keypair so its tokens verify. */
async function makeUser(phone = "+15555550200"): Promise<User> {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  return UserRepository.create(db).insert({ phone, jwtPrivateKey: privateKey, jwtPublicKey: publicKey });
}

describe("WebLinkTokenService.linkFor (AC1, AC2)", () => {
  it("returns ${PUBLIC_APP_URL}/app/#t=<jwt> with a verifiable 30d weblink token", async () => {
    const user = await makeUser();
    process.env.PUBLIC_APP_URL = "https://h.example";
    try {
      const url = await WebLinkTokenService.create(db).linkFor(user.id, "/");
      expect(url.startsWith("https://h.example/app/#t=")).toBe(true);

      const token = url.split("#t=")[1]!;
      const claims = jwt.verify(token, user.jwtPublicKey, { algorithms: ["ES256"] }) as {
        sub: string;
        type: string;
        nonce: number;
        iat: number;
        exp: number;
      };
      expect(claims.sub).toBe(user.id);
      expect(claims.type).toBe("weblink");
      expect(claims.nonce).toBe(0);
      expect(claims.exp - claims.iat).toBeGreaterThanOrEqual(30 * 24 * 3600);
    } finally {
      delete process.env.PUBLIC_APP_URL;
    }
  });

  it("throws when PUBLIC_APP_URL is unset", async () => {
    const user = await makeUser();
    delete process.env.PUBLIC_APP_URL;
    await expect(WebLinkTokenService.create(db).linkFor(user.id, "/")).rejects.toThrow();
  });
});

describe("POST /v1/users/sign_in { web_link } (AC3–AC7)", () => {
  it("exchanges a valid token for a session that authenticates /me (AC3)", async () => {
    const app = buildApp(db);
    const user = await makeUser();
    const { jwt: token } = AuthService.create().mintWebLink(user);

    const res = await app.request("/v1/users/sign_in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: { web_link: token } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(user.id);
    expect(body.auth.access_token.jwt.length).toBeGreaterThan(0);
    expect(body.auth.refresh_token.jwt.length).toBeGreaterThan(0);

    const me = await app.request("/v1/users/me", {
      headers: { authorization: `Bearer ${body.auth.access_token.jwt}` },
    });
    expect(me.status).toBe(200);
    expect((await me.json()).user.id).toBe(user.id);
  });

  it("rejects an expired token with 401 EXPIRED_LINK, no session (AC4)", async () => {
    const app = buildApp(db);
    const user = await makeUser();
    const { jwt: token } = AuthService.create().mintWebLink(user, "-1s");

    const res = await app.request("/v1/users/sign_in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: { web_link: token } }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("EXPIRED_LINK");
    expect(body.auth).toBeUndefined();
  });

  it("rejects a revoked token (bumped web_link_nonce) with 401 EXPIRED_LINK (AC5)", async () => {
    const app = buildApp(db);
    const user = await makeUser();
    const { jwt: token } = AuthService.create().mintWebLink(user);
    await db.update(users).set({ webLinkNonce: 1 }).where(eq(users.id, user.id));

    const res = await app.request("/v1/users/sign_in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: { web_link: token } }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("EXPIRED_LINK");
  });

  it("rejects a wrong-type (access) token and a foreign-key token — both 401, never 500 (AC6)", async () => {
    const app = buildApp(db);
    const user = await makeUser();

    const { access_token } = AuthService.create().mintTokens(user);
    const wrongType = await app.request("/v1/users/sign_in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: { web_link: access_token.jwt } }),
    });
    expect(wrongType.status).toBe(401);
    expect((await wrongType.json()).error.code).toBe("EXPIRED_LINK");

    // A weblink-shaped token whose sub is `user` but signed with a different key.
    const other = await makeUser("+15555550299");
    const forged = jwt.sign({ sub: user.id, type: "weblink", nonce: 0 }, other.jwtPrivateKey, {
      algorithm: "ES256",
      expiresIn: "30d",
    });
    const foreign = await app.request("/v1/users/sign_in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: { web_link: forged } }),
    });
    expect(foreign.status).toBe(401);
    expect((await foreign.json()).error.code).toBe("EXPIRED_LINK");
  });

  it("enforces exactly-one grant: none and two both 400 INVALID_REQUEST (AC7)", async () => {
    const app = buildApp(db);

    const none = await app.request("/v1/users/sign_in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: {} }),
    });
    expect(none.status).toBe(400);
    expect((await none.json()).error.code).toBe("INVALID_REQUEST");

    const two = await app.request("/v1/users/sign_in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: { web_link: "x", refresh_token: "y" } }),
    });
    expect(two.status).toBe(400);
    expect((await two.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("never exposes web_link_nonce in the sign_in user payload (AC8)", async () => {
    const app = buildApp(db);
    const user = await makeUser();
    const { jwt: token } = AuthService.create().mintWebLink(user);

    const res = await app.request("/v1/users/sign_in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: { web_link: token } }),
    });
    const body = await res.json();
    expect(body.user.web_link_nonce).toBeUndefined();
    expect(body.user.webLinkNonce).toBeUndefined();
  });
});
