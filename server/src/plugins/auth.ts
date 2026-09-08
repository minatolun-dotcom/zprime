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
  await app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET ?? "dev-secret",
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
