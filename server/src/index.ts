import { buildServer } from "./app.js";
import { PostgresDatabase } from "./database.js";
import type { PoolConfig } from "pg";

const port = Number(process.env.PORT ?? 3000);
const pluginToken = process.env.PLUGIN_TOKEN ?? "";
const adminToken = process.env.ADMIN_TOKEN ?? "";
const databaseUrl = process.env.DATABASE_URL;
const postgresConfig: PoolConfig | null = databaseUrl
  ? { connectionString: databaseUrl }
  : process.env.PGHOST &&
      process.env.PGDATABASE &&
      process.env.PGUSER &&
      process.env.PGPASSWORD
    ? {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT ?? 5432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
      }
    : null;
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const superAdminSteamIds = (process.env.SUPERADMIN_STEAM_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter((id) => /^[0-9]{17}$/.test(id));
const isProduction = process.env.NODE_ENV === "production";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

for (const [name, token] of [
  ["PLUGIN_TOKEN", pluginToken],
  ["ADMIN_TOKEN", adminToken],
] as const) {
  if (isProduction && (!token || token.length < 32 || token.trim() !== token)) {
    throw new Error(`${name} must be a clean secret of at least 32 characters`);
  }
}

if (isProduction && !postgresConfig) {
  throw new Error("DATABASE_URL must be configured in production");
}

if (isProduction && !process.env.WEB_ORIGIN) {
  throw new Error("WEB_ORIGIN must be configured in production");
}

const origin = new URL(webOrigin);
if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== webOrigin) {
  throw new Error("WEB_ORIGIN must be an HTTP(S) origin without a path");
}

const database = postgresConfig ? new PostgresDatabase(postgresConfig) : null;
const app = buildServer({ pluginToken, adminToken, webOrigin, superAdminSteamIds, database });

if (database) {
  app.addHook("onClose", async () => database.close());
}

try {
  if (database) {
    await database.migrate();
    await database.promoteSuperAdmins(superAdminSteamIds);
  }
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
