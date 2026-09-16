import fastifyPlugin from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import crypto from "node:crypto";

declare module "fastify" {
  interface FastifyRequest {
    userId?: number;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export default fastifyPlugin(async (app) => {
  // R-09 (B-08): fail-fast on missing or known-insecure JWT secrets.
  // The JWT payload is stateless {uid, username} — anyone who knows the secret
  // can forge a token for any user id, so a public default ("dev-secret",
  // "change-me-in-production" from the old compose fallbacks) is a full
  // authentication bypass, not a configuration nit. Always enforced: an
  // explicit secret is one line in any test rig or dev shell.
  const secret = process.env.JWT_SECRET;
  const INSECURE = new Set(["dev-secret", "change-me-in-production"]);
  if (!secret || secret.trim() === "" || INSECURE.has(secret)) {
    throw new Error(
      "Refusing to boot: JWT_SECRET is missing or insecure. " +
        "Set a strong secret in .env (cp .env.example .env) and restart.",
    );
  }
  await app.register(fastifyJwt, {
    secret,
    cookie: { cookieName: "token", signed: false },
  });

  app.decorateRequest("userId", 0);

  app.addHook("preHandler", async (req, reply) => {
    const url = req.routeOptions?.url ?? req.url;
    if (url.startsWith("/api/auth/login") || url === "/api/health") return;
    if (!url.startsWith("/api/")) return;
    try {
      await req.jwtVerify();
      req.userId = (req.user as { uid: number }).uid;
    } catch {
      return reply.code(401).send({ error: "Not authenticated" });
    }
  });
});
