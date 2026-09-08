import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { verifyPassword } from "../plugins/auth.js";

const loginSchema = z.object({ username: z.string(), password: z.string() });

export default async function authRoutes(app: FastifyInstance) {
  app.post("/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Username and password required" });
    const { username, password } = parsed.data;
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }
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
