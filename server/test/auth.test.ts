import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { makeDb, type Database } from "../src/db.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { AuthService } from "../src/services/auth-service.js";
import { UserService } from "../src/services/user-service.js";
import { StubOtpProvider } from "../src/providers/otp-provider.js";
import { buildApp } from "../src/index.js";
import type { User } from "../src/models/user.js";

/**
 * Fast offline auth tests — the ported ES256 session flow against a local `file:`
 * libSQL database (same client build as Turso). No network, no Twilio: the OTP
 * provider is the stub (no Twilio env), fixed code '123456'.
 */
let db: Database;
let dir: string;

beforeEach(async () => {
  const drizzleDir = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
  const sqlFile = readdirSync(drizzleDir).find((f) => f.endsWith(".sql"));
  if (!sqlFile) throw new Error("run `npm run db:generate` first — no drizzle/*.sql found");
  dir = mkdtempSync(join(tmpdir(), "harvest-auth-"));
  const client = createClient({ url: `file:${join(dir, "t.db")}` });
  await client.executeMultiple(readFileSync(join(drizzleDir, sqlFile), "utf8"));
  db = makeDb(client);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Insert a user with a real ES256 keypair so its tokens verify. */
async function makeUser(phone = "+15555550100"): Promise<User> {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  return UserRepository.create(db).insert({ phone, jwtPrivateKey: privateKey, jwtPublicKey: publicKey });
}

describe("AuthService", () => {
  it("mints an access token that verifies round-trip with the user's public key", async () => {
    const auth = AuthService.create();
    const user = await makeUser();
    const { access_token } = auth.mintTokens(user);
    const claims = auth.verify(access_token.jwt, user.jwtPublicKey, "access");
    expect(claims.sub).toBe(user.id);
    expect(claims.nonce).toBe(user.accessTokenNonce);
    expect(access_token.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects a token verified as the wrong type", async () => {
    const auth = AuthService.create();
    const user = await makeUser();
    const { refresh_token } = auth.mintTokens(user);
    expect(() => auth.verify(refresh_token.jwt, user.jwtPublicKey, "access")).toThrow();
  });

  it("a bumped nonce revokes an already-minted access token", async () => {
    const auth = AuthService.create();
    const repo = UserRepository.create(db);
    const user = await makeUser();
    const users = UserService.create(db);
    const { access_token } = auth.mintTokens(user);
    // The token is valid until its nonce is bumped on the user row.
    expect(await users.authenticateAccessToken(access_token.jwt)).toBe(user.id);
    await repo.bumpNonce(user.id, "access");
    expect(await users.authenticateAccessToken(access_token.jwt)).toBeNull();
  });
});

describe("UserService", () => {
  it("createUser provisions a new user and returns a session; a second call returns the same user, not new", async () => {
    const users = UserService.create(db);
    const first = await users.createUser({ phoneNumber: "+15555550123" });
    expect(first.isNew).toBe(true);
    expect(first.tokens.access_token.jwt.length).toBeGreaterThan(0);

    const second = await users.createUser({ phoneNumber: "+15555550123" });
    expect(second.isNew).toBe(false);
    expect(second.user.id).toBe(first.user.id);
  });

  it("provision maps the onboarding payload to columns and stamps completion", async () => {
    const users = UserService.create(db);
    const { user } = await users.createUser({
      phoneNumber: "+15555550124",
      onboarding: { goals: ["eat_healthier"], cook_days: ["mon", "wed"], age: "from_25_to_34" },
    });
    const row = await UserRepository.create(db).findById(user.id);
    expect(row?.goals).toEqual(["eat_healthier"]);
    expect(row?.cookDays).toEqual(["mon", "wed"]);
    expect(row?.age).toBe("from_25_to_34");
    expect(row?.onboardingCompletedAt).toBeInstanceOf(Date);
  });

  it("signs in by OTP (fixed stub code), and by refresh_token", async () => {
    const users = UserService.create(db);
    const created = await users.createUser({ phoneNumber: "+15555550125" });

    const byOtp = await users.signIn({ otp: { phone_number: "+15555550125", code: StubOtpProvider.VALID_CODE } });
    expect(byOtp.user.id).toBe(created.user.id);
    expect(byOtp.isNew).toBe(false);

    const byRefresh = await users.signIn({ refresh_token: created.tokens.refresh_token.jwt });
    expect(byRefresh.user.id).toBe(created.user.id);
  });

  it("rejects the wrong OTP code and an invalid refresh_token", async () => {
    const users = UserService.create(db);
    await users.createUser({ phoneNumber: "+15555550126" });
    await expect(users.signIn({ otp: { phone_number: "+15555550126", code: "000000" } })).rejects.toThrow();
    await expect(users.signIn({ refresh_token: "not-a-jwt" })).rejects.toThrow();
  });
});

describe("authGuard (Hono app.request)", () => {
  it("401s without a token, and passes with a valid bearer", async () => {
    const app = buildApp(db);
    const created = await app.request("/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: { phone_number: "+15555550127" } }),
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(typeof body.auth.access_token.jwt).toBe("string");

    const noAuth = await app.request("/v1/users/me");
    expect(noAuth.status).toBe(401);

    const withAuth = await app.request("/v1/users/me", {
      headers: { authorization: `Bearer ${body.auth.access_token.jwt}` },
    });
    expect(withAuth.status).toBe(200);
    expect((await withAuth.json()).user.id).toBe(body.user.id);
  });
});
