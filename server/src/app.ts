import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { CreateMatchInput, MatchStore } from "./database.js";

export interface ServerConfig {
  pluginToken: string;
  adminToken: string;
  webOrigin: string;
  database?: MatchStore | null;
}

const unauthorized = {
  error: { code: "UNAUTHORIZED", message: "Authentication required" },
};

const invalidRequest = {
  error: { code: "VALIDATION_ERROR", message: "Invalid request" },
};

const databaseUnavailable = {
  error: { code: "DATABASE_UNAVAILABLE", message: "Database unavailable" },
};

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

export const buildServer = ({ pluginToken, adminToken, webOrigin, database = null }: ServerConfig) => {
  const app = Fastify({ bodyLimit: 4096 });

  app.register(cors, {
    origin: webOrigin,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Error && "validation" in error) {
      return reply.code(400).send(invalidRequest);
    }

    request.log.error(error);
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!adminToken) {
      return reply.code(503).send({
        error: { code: "ADMIN_INTEGRATION_DISABLED", message: "Admin integration unavailable" },
      });
    }

    if (!isAuthorized(request.headers.authorization, adminToken)) {
      return reply.code(401).send(unauthorized);
    }
  };

  app.get("/api/health", async () => ({
    status: "ok",
    service: "cshome-api",
    timestamp: new Date().toISOString(),
  }));

  app.get("/api/ready", async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);

    try {
      await database.ping();
    } catch (error) {
      request.log.warn(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Database readiness check failed",
      );
      return reply.code(503).send(databaseUnavailable);
    }

    return {
      status: "ready",
      service: "cshome-api",
      database: "connected",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/api/admin/matches", { onRequest: requireAdmin }, async (_, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    return { matches: await database.listMatches() };
  });

  app.post(
    "/api/admin/matches",
    {
      onRequest: requireAdmin,
      schema: { body: matchSchema },
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send(databaseUnavailable);
      const match = await database.createMatch(request.body as CreateMatchInput);
      return reply.code(201).send({ match });
    },
  );

  app.post(
    "/api/plugin/heartbeat",
    {
      onRequest: async (request, reply) => {
        if (!pluginToken) {
          return reply.code(503).send({
            error: { code: "PLUGIN_INTEGRATION_DISABLED", message: "Plugin integration unavailable" },
          });
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
          },
        },
      },
    },
    async (_, reply) =>
      reply.code(202).send({
        accepted: true,
        receivedAt: new Date().toISOString(),
      }),
  );

  return app;
};
