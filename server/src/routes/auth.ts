import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../plugins/auth.js";
import {
  isLoginLocked,
  loginKey,
  recordLoginFailure,
  resetLoginFailures,
  loginRetryAfterSeconds,
} from "../lib/loginGuard.js";

const loginSchema = z.object({ username: z.string(), password: z.string() });

// R-13 (F-13-2): scrypt runs only when the username exists, so response
// timing (live-measured 43 ms vs 2 ms) enumerates valid usernames. Burn one
// scrypt on the unknown-user path too so both failure paths do identical
// work. Computed once at module load; the value is never matched for real.
const DUMMY_HASH = hashPassword("r13-timing-equalizer");

export default async function authRoutes(app: FastifyInstance) {
  app.post("/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Username and password required" });
    const { username, password } = parsed.data;
    const key = loginKey(req.ip, username);
    // R-13 (F-13-1): lockout check BEFORE any user lookup — a locked pair
    // learns nothing about whether the account exists.
    if (isLoginLocked(key)) {
      return reply
        .code(429)
        .header("retry-after", String(loginRetryAfterSeconds(key)))
        .send({ error: "Too many login attempts" });
    }
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!user) {
      // R-13 (F-13-2): equalize timing with the wrong-password path — one
      // scrypt runs on every failure path, existing user or not.
      verifyPassword(password, DUMMY_HASH);
      recordLoginFailure(key);
      return reply.code(401).send({ error: "Invalid username or password" });
    }
    if (!verifyPassword(password, user.passwordHash)) {
      recordLoginFailure(key);
      return reply.code(401).send({ error: "Invalid username or password" });
    }
    resetLoginFailures(key);
    const token = app.jwt.sign({ uid: user.id, username: user.username }, { expiresIn: "7d" });
    reply.setCookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 3600,
    });
    return { username: user.username };
  });

  app.post("/logout", async (_req, reply) => {
    reply.clearCookie("token", { path: "/" });
    return { ok: true };
  });

  app.get("/me", async (req) => {
    return { username: (req.user as any)?.username ?? null };
  });
}
