import { randomBytes, timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  hashSessionToken,
  type CreateMatchInput,
  type MatchStore,
  type UserRecord,
} from "./database.js";

export interface ServerConfig {
  pluginToken: string;
  adminToken: string;
  webOrigin: string;
  database?: MatchStore | null;
}

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: UserRecord;
  }
}

const unauthorized = { error: { code: "UNAUTHORIZED", message: "Authentication required" } };
const invalidRequest = { error: { code: "VALIDATION_ERROR", message: "Invalid request" } };
const databaseUnavailable = { error: { code: "DATABASE_UNAVAILABLE", message: "Database unavailable" } };

const isAuthorized = (authorization: string | undefined, expectedToken: string) => {
  if (!authorization?.startsWith("Bearer ") || !expectedToken) return false;
  const provided = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
};

const matchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "mapName", "teamAName", "teamBName", "maxRounds"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    mapName: { type: "string", minLength: 1, maxLength: 40 },
    teamAName: { type: "string", minLength: 1, maxLength: 64 },
    teamBName: { type: "string", minLength: 1, maxLength: 64 },
    maxRounds: { type: "integer", minimum: 1, maximum: 30 },
  },
} as const;

const SESSION_COOKIE = "cshome_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const STEAM_CLAIMED = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

const parseCookies = (header: string | undefined): Record<string, string> => {
  const cookies: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq > 0) cookies[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return cookies;
};

export const buildServer = ({ pluginToken, adminToken, webOrigin, database = null }: ServerConfig) => {
  const app = Fastify({ bodyLimit: 8192 });
  const secureCookie = webOrigin.startsWith("https:");

  app.register(cors, {
    origin: webOrigin,
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Error && "validation" in error) {
      return reply.code(400).send(invalidRequest);
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  const sessionUser = async (request: FastifyRequest): Promise<UserRecord | null> => {
    if (!database) return null;
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const found = await database.findSessionUser(hashSessionToken(token));
    if (!found) return null;
    request.currentUser = found.user;
    void database.touchSession(found.sessionId).catch(() => undefined);
    return found.user;
  };

  const requireUser = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const user = await sessionUser(request);
    if (!user) return reply.code(401).send(unauthorized);
  };

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!adminToken) {
      return reply.code(503).send({ error: { code: "ADMIN_INTEGRATION_DISABLED", message: "Admin integration unavailable" } });
    }
    if (!isAuthorized(request.headers.authorization, adminToken)) {
      return reply.code(401).send(unauthorized);
    }
  };

  app.get("/api/health", async () => ({ status: "ok", service: "cshome-api", timestamp: new Date().toISOString() }));

  app.get("/api/ready", async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    try {
      await database.ping();
    } catch (error) {
      request.log.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Database readiness check failed");
      return reply.code(503).send(databaseUnavailable);
    }
    return { status: "ready", service: "cshome-api", database: "connected", timestamp: new Date().toISOString() };
  });

  app.get("/api/auth/steam", async (_, reply) => {
    const params = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": `${webOrigin}/api/auth/steam/return`,
      "openid.realm": webOrigin,
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    });
    return reply.redirect(`${STEAM_OPENID}?${params}`);
  });

  app.get("/api/auth/steam/return", async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const query = request.query as Record<string, string>;
    if (query["openid.mode"] !== "id_res") return reply.code(400).send(invalidRequest);
    const steamId = STEAM_CLAIMED.exec(query["openid.claimed_id"] ?? "")?.[1];
    if (!steamId) return reply.code(400).send(invalidRequest);
    if (query["openid.return_to"] !== `${webOrigin}/api/auth/steam/return`) {
      return reply.code(400).send(invalidRequest);
    }

    const verify = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith("openid.")) verify.set(key, value);
    }
    verify.set("openid.mode", "check_authentication");
    const response = await fetch(STEAM_OPENID, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: verify.toString(),
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.text();
    if (!body.includes("is_valid:true")) {
      request.log.warn("Steam OpenID verification failed");
      return reply.code(401).send(unauthorized);
    }

    const user = await database.upsertSteamUser(steamId);
    const token = randomBytes(32).toString("base64url");
    await database.createSession(user.id, hashSessionToken(token), new Date(Date.now() + SESSION_TTL_MS));
    reply.header(
      "Set-Cookie",
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secureCookie ? "; Secure" : ""}`,
    );
    return reply.redirect("/");
  });

  app.get("/api/auth/me", async (request, reply) => {
    const user = await sessionUser(request);
    if (!user) return reply.code(401).send(unauthorized);
    return { user };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (database && token) await database.deleteSession(hashSessionToken(token));
    reply.header("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return { loggedOut: true };
  });

  app.get("/api/presence", { onRequest: requireUser }, async (_, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const [site, server] = await Promise.all([
      database.listOnlineUsers(300),
      database.listServerPlayers(90),
    ]);
    return { site, server };
  });

  app.get("/api/matches", { onRequest: requireUser }, async (_, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const matches = await database.listMatches();
    const players = await Promise.all(matches.map((m) => database.listMatchPlayers(m.id)));
    return { matches: matches.map((m, i) => ({ ...m, players: players[i] })) };
  });

  app.post("/api/matches", { onRequest: requireUser, schema: { body: matchSchema } }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const match = await database.createMatch({ ...(request.body as CreateMatchInput), createdBy: request.currentUser!.id });
    await database.joinMatch(match.id, request.currentUser!.id);
    return reply.code(201).send({ match });
  });

  app.post("/api/matches/:id/join", { onRequest: requireUser }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const { id } = request.params as { id: string };
    await database.joinMatch(id, request.currentUser!.id);
    return { joined: true, matchId: id };
  });

  app.post(
    "/api/matches/:id/invites",
    {
      onRequest: requireUser,
      schema: { body: { type: "object", additionalProperties: false, required: ["steamId"], properties: { steamId: { type: "string", pattern: "^[0-9]{17}$" } } } },
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send(databaseUnavailable);
      const { id } = request.params as { id: string };
      const { steamId } = request.body as { steamId: string };
      await database.createInvite(id, request.currentUser!.id, steamId);
      return reply.code(201).send({ invited: true });
    },
  );

  app.get("/api/invites", { onRequest: requireUser }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    return { invites: await database.listInvitesForUser(request.currentUser!.id) };
  });

  app.post("/api/invites/:id/respond", { onRequest: requireUser }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const { id } = request.params as { id: string };
    const { accept } = request.body as { accept?: boolean };
    await database.respondInvite(id, request.currentUser!.id, accept === true);
    return { responded: true };
  });

  app.get("/api/admin/matches", { onRequest: requireAdmin }, async (_, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    return { matches: await database.listMatches() };
  });

  app.post("/api/admin/matches", { onRequest: requireAdmin, schema: { body: matchSchema } }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const match = await database.createMatch(request.body as CreateMatchInput);
    return reply.code(201).send({ match });
  });

  app.post(
    "/api/plugin/heartbeat",
    {
      onRequest: async (request, reply) => {
        if (!pluginToken) {
          return reply.code(503).send({ error: { code: "PLUGIN_INTEGRATION_DISABLED", message: "Plugin integration unavailable" } });
        }
        if (!isAuthorized(request.headers.authorization, pluginToken)) {
          return reply.code(401).send(unauthorized);
        }
      },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["pluginVersion", "sentAt"],
          properties: {
            pluginVersion: { type: "string", minLength: 1, maxLength: 64 },
            sentAt: { type: "string", format: "date-time", maxLength: 40 },
            players: {
              type: "array",
              maxItems: 64,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["steamId", "name"],
                properties: {
                  steamId: { type: "string", pattern: "^[0-9]{17}$" },
                  name: { type: "string", minLength: 1, maxLength: 64 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { players } = request.body as { players?: { steamId: string; name: string }[] };
      if (database && players) {
        await database.reportServerPlayers(players).catch((error) => request.log.warn(error, "Failed to record server players"));
      }
      return reply.code(202).send({ accepted: true, receivedAt: new Date().toISOString() });
    },
  );

  return app;
};
