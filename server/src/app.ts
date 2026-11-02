import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import Fastify from "fastify";
import type { DatabaseHealthProbe } from "./database.js";

export interface ServerConfig {
  pluginToken: string;
  webOrigin: string;
  database?: DatabaseHealthProbe | null;
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

export const buildServer = ({ pluginToken, webOrigin, database = null }: ServerConfig) => {
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
