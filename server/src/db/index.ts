import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "./schema.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://zprime:zprime@localhost:5432/zprime";

const queryClient = postgres(DATABASE_URL, { max: 10 });
export const db = drizzle(queryClient, { schema });

export async function runMigrations() {
  const dir = process.env.MIGRATIONS_DIR ?? path.resolve(__dirname, "../../drizzle");
  await migrate(db, { migrationsFolder: dir });
}
