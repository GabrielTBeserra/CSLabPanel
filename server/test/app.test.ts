import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/app.js";

describe("API foundation", () => {
  let app: FastifyInstance;

  before(async () => {
    app = buildServer({
      pluginToken: "test-plugin-token",
      webOrigin: "http://localhost:5173",
    });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("reports API health without exposing configuration", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: "ok",
      service: "cshome-api",
      timestamp: response.json().timestamp,
    });
    assert.equal(response.json().pluginToken, undefined);
  });

  it("reports readiness only when the database probe succeeds", async () => {
    const readyApp = buildServer({
      pluginToken: "test-plugin-token",
      webOrigin: "http://localhost:5173",
      database: { ping: async () => undefined },
    });
    const response = await readyApp.inject({ method: "GET", url: "/api/ready" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: "ready",
      service: "cshome-api",
      database: "connected",
      timestamp: response.json().timestamp,
    });
    await readyApp.close();
  });

  it("returns a generic readiness error when the database probe fails", async () => {
    const readyApp = buildServer({
      pluginToken: "test-plugin-token",
      webOrigin: "http://localhost:5173",
      database: { ping: async () => { throw new Error("connection details must stay private"); } },
    });
    const response = await readyApp.inject({ method: "GET", url: "/api/ready" });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      error: { code: "DATABASE_UNAVAILABLE", message: "Database unavailable" },
    });
    assert.equal(response.body.includes("connection details must stay private"), false);
    await readyApp.close();
  });

  it("rejects plugin heartbeats without a valid bearer token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/plugin/heartbeat",
      payload: { pluginVersion: "0.1.0", sentAt: new Date().toISOString() },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
  });

  it("accepts a valid authenticated plugin heartbeat", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/plugin/heartbeat",
      headers: { authorization: "Bearer test-plugin-token" },
      payload: { pluginVersion: "0.1.0", sentAt: new Date().toISOString() },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(response.json().accepted, true);
    assert.equal(typeof response.json().receivedAt, "string");
    assert.equal(response.body.includes("test-plugin-token"), false);
  });

  it("rejects malformed heartbeat payloads with a normalized error", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/plugin/heartbeat",
      headers: { authorization: "Bearer test-plugin-token" },
      payload: { pluginVersion: "", extra: true },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: { code: "VALIDATION_ERROR", message: "Invalid request" },
    });
  });
});
