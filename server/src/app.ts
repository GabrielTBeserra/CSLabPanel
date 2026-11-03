import { randomBytes, timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  hashSessionToken,
  type CreateMatchInput,
  type MatchRecord,
  type MatchStore,
  type UserRecord,
} from "./database.js";
import { applyMatchzyEvent, buildMatchzyConfig, parseStatusJson, seriesMaps, type ConnectedPlayer } from "./live.js";
import { quoteArg, sendRconCommand, type RconConfig } from "./rcon.js";
import { RealtimeBus, type RealtimeEvent } from "./realtime.js";

export interface ServerConfig {
  pluginToken: string;
  adminToken: string;
  webOrigin: string;
  superAdminSteamIds?: string[];
  database?: MatchStore | null;
  rcon?: RconConfig | null;
  pluginApiUrl?: string;
  connectAddress?: string;
  sendRcon?: (config: RconConfig, command: string) => Promise<string>;
  presencePollMs?: number;
  tunnelHostSuffixes?: string[];
}

const TUNNEL_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const isStaff = (user: UserRecord) => user.role === "admin" || user.role === "superadmin";
const canManageMatch = (match: MatchRecord, user: UserRecord) => match.createdBy === user.id || isStaff(user);

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: UserRecord;
  }
}

const unauthorized = { error: { code: "UNAUTHORIZED", message: "Authentication required" } };
const forbidden = { error: { code: "FORBIDDEN", message: "Insufficient permissions" } };
const notFound = { error: { code: "NOT_FOUND", message: "Match not found" } };
const teamsLocked = { error: { code: "TEAMS_LOCKED", message: "Teams are locked after the lobby phase" } };
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
    format: { type: "string", enum: ["bo1", "bo3"] },
    mapPool: { type: "array", minItems: 3, maxItems: 10, uniqueItems: true, items: { type: "string", pattern: "^de_[a-z0-9_]+$" } },
    knifeRound: { type: "boolean" },
    preset: { type: "string", enum: ["official", "official_noknife", "quick", "scrim", "custom"] },
    overtime: { type: "boolean" },
    overtimeRounds: { type: "integer", enum: [2, 4, 6, 8, 10] },
    playout: { type: "boolean" },
  },
} as const;

interface VetoStep {
  action: "ban" | "pick";
  team: "a" | "b";
}

export const vetoSteps = (format: "bo1" | "bo3", poolSize: number): VetoStep[] => {
  const picks = format === "bo3" ? 2 : 0;
  const bans = Math.max(poolSize - 1 - picks, 0);
  const leadingBans = format === "bo3" ? Math.min(2, bans) : bans;
  const actions: VetoStep["action"][] = [
    ...Array<VetoStep["action"]>(leadingBans).fill("ban"),
    ...Array<VetoStep["action"]>(picks).fill("pick"),
    ...Array<VetoStep["action"]>(bans - leadingBans).fill("ban"),
  ];
  return actions.map((action, i) => ({ action, team: i % 2 === 0 ? "a" : "b" }));
};

type PresetRules = Required<Pick<CreateMatchInput, "maxRounds" | "knifeRound" | "overtime" | "overtimeRounds" | "playout">>;

export const MATCH_PRESETS: Record<Exclude<NonNullable<CreateMatchInput["preset"]>, "custom">, PresetRules> = {
  official: { maxRounds: 24, knifeRound: true, overtime: true, overtimeRounds: 6, playout: false },
  official_noknife: { maxRounds: 24, knifeRound: false, overtime: true, overtimeRounds: 6, playout: false },
  quick: { maxRounds: 16, knifeRound: false, overtime: false, overtimeRounds: 6, playout: false },
  scrim: { maxRounds: 24, knifeRound: false, overtime: false, overtimeRounds: 6, playout: true },
};

export const resolveMatchInput = (input: CreateMatchInput): CreateMatchInput => {
  const preset = input.preset ?? "custom";
  return preset === "custom" ? { ...input, preset } : { ...input, ...MATCH_PRESETS[preset], preset };
};

const DEFAULT_POOL = ["de_mirage", "de_inferno", "de_nuke", "de_ancient", "de_anubis", "de_vertigo", "de_overpass"];
const poolOf = (match: MatchRecord) => (match.mapPool.length >= 3 ? match.mapPool : DEFAULT_POOL);

const STEAM_PROFILE_XML = "https://steamcommunity.com/profiles";
const XML_TAG = (tag: string) => new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([^<]+?)(?:\\]\\]>)?</${tag}>`);

const fetchSteamProfile = async (steamId: string): Promise<{ name: string; avatar: string } | null> => {
  try {
    const response = await fetch(`${STEAM_PROFILE_XML}/${steamId}/?xml=1`, {
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "cshome-panel/1.0" },
    });
    if (!response.ok) return null;
    const xml = await response.text();
    const name = XML_TAG("steamID").exec(xml)?.[1]?.trim();
    const avatar = XML_TAG("avatarFull").exec(xml)?.[1]?.trim()
      ?? XML_TAG("avatarMedium").exec(xml)?.[1]?.trim();
    return name ? { name: name.slice(0, 64), avatar: avatar ?? "" } : null;
  } catch {
    return null;
  }
};

const LOAD_CONFIRM_TIMEOUT_MS = 25000;
const PLUGIN_PRESENCE_TTL_MS = 20000;
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

export const buildServer = ({
  pluginToken, adminToken, webOrigin, superAdminSteamIds = [], database = null,
  rcon = null, pluginApiUrl = "", connectAddress = "", sendRcon = sendRconCommand, presencePollMs = 0,
  tunnelHostSuffixes = [".trycloudflare.com"],
}: ServerConfig) => {
  const app = Fastify({ bodyLimit: 8192 });
  const webHost = new URL(webOrigin).host;
  const requestOrigin = (request: FastifyRequest) => {
    const forwarded = request.headers["x-forwarded-host"];
    const host = String((Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? request.headers.host ?? "").split(",")[0]!.trim().toLowerCase();
    if (host && host !== webHost && tunnelHostSuffixes.some((suffix) => host.endsWith(suffix)) && TUNNEL_HOST.test(host)) return `https://${host}`;
    return webOrigin;
  };
  const bus = new RealtimeBus();
  const publish = (event: RealtimeEvent) => bus.publish(event);
  const publishMatch = (matchId: string) => { publish({ type: "match", matchId }); publish({ type: "matches" }); };

  const requirePlugin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!pluginToken) {
      return reply.code(503).send({ error: { code: "PLUGIN_INTEGRATION_DISABLED", message: "Plugin integration unavailable" } });
    }
    if (!isAuthorized(request.headers.authorization, pluginToken)) return reply.code(401).send(unauthorized);
  };

  let connectedPlayers: ConnectedPlayer[] = [];
  let presenceKey = "";
  let lastPluginReportAt = 0;
  const setConnectedPlayers = async (players: ConnectedPlayer[]) => {
    connectedPlayers = players;
    const key = players.map((p) => `${p.steamId}:${p.name}`).sort().join("|");
    if (database) await database.replaceServerPlayers(players);
    if (key !== presenceKey) {
      presenceKey = key;
      publish({ type: "presence" });
    }
  };
  const pollServerPresence = async () => {
    if (!rcon || Date.now() - lastPluginReportAt < PLUGIN_PRESENCE_TTL_MS) return;
    const players = parseStatusJson(await sendRcon(rcon, "status_json"));
    if (players) await setConnectedPlayers(players);
  };
  if (presencePollMs > 0) {
    let timer: NodeJS.Timeout | undefined;
    let polling = false;
    app.addHook("onReady", async () => {
      timer = setInterval(() => {
        if (polling) return;
        polling = true;
        void pollServerPresence()
          .catch((error) => app.log.debug({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Presence poll failed"))
          .finally(() => { polling = false; });
      }, presencePollMs);
      timer.unref();
    });
    app.addHook("onClose", async () => clearInterval(timer));
  }

  const loadOnServer = async (match: MatchRecord): Promise<{ ok: boolean; error?: string }> => {
    if (!database) return { ok: false, error: "Database unavailable" };
    if (!rcon || !pluginApiUrl) {
      await database.setServerState(match.id, "error", "Integração com o servidor CS2 não configurada");
      publishMatch(match.id);
      return { ok: false, error: "Servidor CS2 não configurado" };
    }
    const active = await database.findActiveServerMatch();
    if (active && active.id !== match.id) {
      await database.setServerState(match.id, "error", `Servidor ocupado com a partida "${active.name}"`);
      publishMatch(match.id);
      return { ok: false, error: "Servidor ocupado" };
    }
    await database.setServerState(match.id, "loading");
    await database.setLive(match.id, {});
    publishMatch(match.id);
    try {
      const url = `${pluginApiUrl}/api/plugin/matches/${match.matchNumber}/config`;
      await sendRcon(rcon, `matchzy_loadmatch_url ${quoteArg(url)} ${quoteArg("Authorization")} ${quoteArg(`Bearer ${pluginToken}`)}`);
      setTimeout(() => {
        void database.getMatchById(match.id).then(async (current) => {
          if (current?.serverState !== "loading") return;
          await database.setServerState(match.id, "error", "O MatchZy não confirmou a partida (outra partida carregada no servidor?)");
          publishMatch(match.id);
        }).catch(() => undefined);
      }, LOAD_CONFIRM_TIMEOUT_MS).unref();
      return { ok: true };
    } catch (error) {
      app.log.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "RCON load failed");
      await database.setServerState(match.id, "error", "Não foi possível falar com o servidor CS2 (RCON)");
      publishMatch(match.id);
      return { ok: false, error: "RCON indisponível" };
    }
  };

  app.register(cors, {
    origin: webOrigin,
    credentials: true,
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  app.register(websocket, { options: { maxPayload: 1024 } });

  const requireSameOrigin = async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = request.headers.origin;
    if (!origin) return;
    let originHost = "";
    try { originHost = new URL(origin).host.toLowerCase(); } catch { originHost = ""; }
    if (originHost !== new URL(requestOrigin(request)).host) return reply.code(403).send(forbidden);
  };

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

  const requireStaff = async (request: FastifyRequest, reply: FastifyReply) => {
    await requireUser(request, reply);
    if (reply.sent) return;
    if (!isStaff(request.currentUser!)) return reply.code(403).send(forbidden);
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

  app.get("/api/auth/steam", async (request, reply) => {
    const origin = requestOrigin(request);
    const params = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": `${origin}/api/auth/steam/return`,
      "openid.realm": origin,
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
    const origin = requestOrigin(request);
    if (query["openid.return_to"] !== `${origin}/api/auth/steam/return`) {
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
    if (superAdminSteamIds.includes(steamId) && user.role !== "superadmin") await database.promoteSuperAdmins([steamId]);
    void fetchSteamProfile(steamId)
      .then((profile) => (profile ? database.updateUserProfile(steamId, profile.name, profile.avatar || null) : undefined))
      .catch(() => undefined);
    const token = randomBytes(32).toString("base64url");
    await database.createSession(user.id, hashSessionToken(token), new Date(Date.now() + SESSION_TTL_MS));
    reply.header(
      "Set-Cookie",
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${origin.startsWith("https:") ? "; Secure" : ""}`,
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
    const vetoes = await Promise.all(matches.map((m) => database.listVetoes(m.id)));
    return { matches: matches.map((m, i) => ({ ...m, players: players[i], vetoes: vetoes[i] })) };
  });

  app.post("/api/matches", { onRequest: requireUser, schema: { body: matchSchema } }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const match = await database.createMatch({ ...resolveMatchInput(request.body as CreateMatchInput), createdBy: request.currentUser!.id });
    await database.joinMatch(match.id, request.currentUser!.id);
    publishMatch(match.id);
    return reply.code(201).send({ match });
  });

  app.post("/api/matches/:id/join", { onRequest: requireUser }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const { id } = request.params as { id: string };
    const match = await database.getMatchById(id);
    if (!match) return reply.code(404).send(notFound);
    if (match.phase !== "lobby") return reply.code(409).send(teamsLocked);
    await database.joinMatch(id, request.currentUser!.id);
    publishMatch(id);
    return { joined: true, matchId: id };
  });

  app.get("/api/matches/:id", { onRequest: requireUser }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const { id } = request.params as { id: string };
    const match = await database.getMatchById(id);
    if (!match) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Match not found" } });
    const [players, vetoes] = await Promise.all([database.listMatchPlayers(id), database.listVetoes(id)]);
    return { match: { ...match, players, vetoes }, connectAddress: connectAddress || null };
  });

  app.post(
    "/api/matches/:id/team",
    {
      onRequest: requireUser,
      schema: { body: { type: "object", additionalProperties: false, required: ["team"], properties: { team: { type: "string", enum: ["a", "b"] } } } },
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send(databaseUnavailable);
      const { id } = request.params as { id: string };
      const { team } = request.body as { team: "a" | "b" };
      const match = await database.getMatchById(id);
      if (!match) return reply.code(404).send(notFound);
      if (match.phase !== "lobby") return reply.code(409).send(teamsLocked);
      await database.joinMatch(id, request.currentUser!.id);
      await database.setPlayerTeam(id, request.currentUser!.id, team);
      publishMatch(id);
      return { joined: true, matchId: id, team };
    },
  );

  app.post("/api/matches/:id/shuffle", { onRequest: requireUser }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const { id } = request.params as { id: string };
    const match = await database.getMatchById(id);
    if (!match) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Match not found" } });
    if (!canManageMatch(match, request.currentUser!)) return reply.code(403).send(forbidden);
    if (match.phase !== "lobby") return reply.code(409).send({ error: { code: "INVALID_PHASE", message: "Teams are locked" } });
    const players = await database.listMatchPlayers(id);
    for (let i = players.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [players[i], players[j]] = [players[j]!, players[i]!];
    }
    await Promise.all(players.map((p, i) => database.setPlayerTeam(id, p.userId, i % 2 === 0 ? "a" : "b")));
    publishMatch(id);
    return { shuffled: true, matchId: id };
  });

  app.post("/api/matches/:id/veto/start", { onRequest: requireUser }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const { id } = request.params as { id: string };
    const match = await database.getMatchById(id);
    if (!match) return reply.code(404).send(invalidRequest);
    if (!canManageMatch(match, request.currentUser!)) return reply.code(403).send(forbidden);
    if (match.phase !== "lobby") return reply.code(409).send({ error: { code: "INVALID_PHASE", message: "Veto already started" } });
    const pool = poolOf(match);
    const { captainBSteamId } = (request.body ?? {}) as { captainBSteamId?: string };
    const players = await database.listMatchPlayers(id);
    let captainBId: string | null = null;
    if (captainBSteamId) {
      const captainB = await database.findUserBySteamId(captainBSteamId);
      if (!captainB || !players.some((p) => p.userId === captainB.id)) {
        return reply.code(400).send({ error: { code: "CAPTAIN_NOT_IN_MATCH", message: "Captain must be a match player" } });
      }
      captainBId = captainB.id;
    } else {
      captainBId = players.find((p) => p.userId !== request.currentUser!.id)?.userId ?? null;
    }
    await database.setMatchCaptains(id, request.currentUser!.id, captainBId);
    await database.setMatchPhase(id, "veto");
    publishMatch(id);
    return { started: true, matchId: id, mapPool: pool, captainAId: request.currentUser!.id, captainBId };
  });

  app.post("/api/matches/:id/veto", { onRequest: requireUser }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const { id } = request.params as { id: string };
    const match = await database.getMatchById(id);
    if (!match || match.phase !== "veto") {
      return reply.code(409).send({ error: { code: "INVALID_PHASE", message: "Match is not in veto phase" } });
    }
    const user = request.currentUser!;
    const vetoes = await database.listVetoes(id);
    const pool = poolOf(match);
    const used = new Set(vetoes.filter((v) => v.mapName).map((v) => v.mapName));
    const remaining = pool.filter((m) => !used.has(m));
    const steps = vetoSteps(match.format, pool.length);
    const mapSteps = vetoes.filter((v) => v.actorName !== "Decider" && v.action !== "side").length;
    const body = request.body as { action?: string; mapName?: string; side?: string };

    if (mapSteps >= steps.length) {
      if (body.action !== "side" || (body.side !== "a" && body.side !== "b")) {
        return reply.code(400).send({ error: { code: "SIDE_REQUIRED", message: "Choose side 'a' or 'b'" } });
      }
      const sideCaptain = match.captainBId ?? match.captainAId;
      if (user.id !== sideCaptain) return reply.code(403).send(unauthorized);
      await database.insertVeto({
        matchId: id, seq: vetoes.length + 1, action: "side", mapName: null,
        team: body.side as "a" | "b", actorSteamId: user.steamId, actorName: user.displayName,
      });
      await database.setMatchSide(id, body.side as "a" | "b");
      await finishVeto(id);
      return { finished: true, side: body.side, remaining };
    }

    const step = steps[mapSteps]!;
    const expectedCaptain = step.team === "a" ? match.captainAId : match.captainBId;
    if (!expectedCaptain || user.id !== expectedCaptain) {
      return reply.code(403).send({ error: { code: "NOT_YOUR_TURN", message: "It is the other captain's turn" } });
    }
    if (body.action !== step.action || !body.mapName || !remaining.includes(body.mapName)) {
      return reply.code(400).send({ error: { code: "INVALID_VETO", message: `Expected ${step.action} on a remaining map` } });
    }
    await database.insertVeto({
      matchId: id, seq: vetoes.length + 1, action: step.action, mapName: body.mapName,
      team: step.team, actorSteamId: user.steamId, actorName: user.displayName,
    });

    const nowRemaining = remaining.filter((m) => m !== body.mapName);
    const vetoDone = mapSteps + 1 === steps.length;
    if (vetoDone && nowRemaining.length === 1) {
      await database.insertVeto({
        matchId: id, seq: vetoes.length + 2, action: "pick", mapName: nowRemaining[0]!,
        team: null, actorSteamId: "system", actorName: "Decider",
      });
    }
    if (vetoDone && match.knifeRound) await finishVeto(id);
    else publishMatch(id);
    return { accepted: true, next: vetoDone ? (match.knifeRound ? "knife" : "side") : steps[mapSteps + 1], remaining: nowRemaining };
  });

  const finishVeto = async (id: string) => {
    if (!database) return;
    await database.setMatchPhase(id, "live");
    publishMatch(id);
    const match = await database.getMatchById(id);
    if (match) void loadOnServer(match);
  };

  app.post("/api/matches/:id/server/load", { onRequest: requireUser }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const { id } = request.params as { id: string };
    const match = await database.getMatchById(id);
    if (!match) return reply.code(404).send(notFound);
    if (!canManageMatch(match, request.currentUser!)) return reply.code(403).send(forbidden);
    if (match.phase !== "live") return reply.code(409).send({ error: { code: "INVALID_PHASE", message: "Finish the veto first" } });
    const result = await loadOnServer(match);
    return result.ok ? { loading: true } : reply.code(409).send({ error: { code: "SERVER_LOAD_FAILED", message: result.error } });
  });

  app.post("/api/matches/:id/server/end", { onRequest: requireStaff }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const { id } = request.params as { id: string };
    const match = await database.getMatchById(id);
    if (!match) return reply.code(404).send(notFound);
    if (rcon) await sendRcon(rcon, "css_endmatch").catch(() => undefined);
    await database.setServerState(id, "finished");
    await database.setMatchPhase(id, "finished");
    publishMatch(id);
    return { ended: true };
  });

  const requireSuperAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    await requireUser(request, reply);
    if (reply.sent) return;
    if (request.currentUser!.role !== "superadmin") return reply.code(403).send(forbidden);
  };

  app.get("/api/dynamic/players", { onRequest: requireSuperAdmin }, async (_, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    if (!rcon) return reply.code(503).send({ error: { code: "SERVER_NOT_CONFIGURED", message: "CS2 server integration unavailable" } });
    await pollServerPresence().catch(() => undefined);
    const [users, active] = await Promise.all([
      Promise.all(connectedPlayers.map((p) => database.findUserBySteamId(p.steamId))),
      database.findActiveServerMatch(),
    ]);
    return {
      players: connectedPlayers.map((p, i) => ({ ...p, avatarUrl: users[i]?.avatarUrl ?? null, registered: Boolean(users[i]) })),
      activeMatch: active ? { id: active.id, name: active.name, serverState: active.serverState } : null,
    };
  });

  const steamIdList = { type: "array", minItems: 1, maxItems: 10, uniqueItems: true, items: { type: "string", pattern: "^[0-9]{17}$" } } as const;

  app.post(
    "/api/dynamic/start",
    {
      onRequest: requireSuperAdmin,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["teamA", "teamB", "maps", "format", "preset"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            teamAName: { type: "string", minLength: 1, maxLength: 64 },
            teamBName: { type: "string", minLength: 1, maxLength: 64 },
            teamA: steamIdList,
            teamB: steamIdList,
            maps: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: { type: "string", pattern: "^de_[a-z0-9_]+$" } },
            format: { type: "string", enum: ["bo1", "bo3"] },
            preset: matchSchema.properties.preset,
            maxRounds: matchSchema.properties.maxRounds,
            knifeRound: { type: "boolean" },
            overtime: { type: "boolean" },
            overtimeRounds: matchSchema.properties.overtimeRounds,
            playout: { type: "boolean" },
            force: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send(databaseUnavailable);
      const body = request.body as {
        name?: string; teamAName?: string; teamBName?: string; teamA: string[]; teamB: string[]; maps: string[];
        format: "bo1" | "bo3"; preset: NonNullable<CreateMatchInput["preset"]>; maxRounds?: number; knifeRound?: boolean;
        overtime?: boolean; overtimeRounds?: number; playout?: boolean; force?: boolean;
      };
      if (body.teamA.some((id) => body.teamB.includes(id))) {
        return reply.code(400).send({ error: { code: "PLAYER_IN_BOTH_TEAMS", message: "A player cannot be on both teams" } });
      }
      if (body.maps.length !== (body.format === "bo3" ? 3 : 1)) {
        return reply.code(400).send({ error: { code: "INVALID_MAPS", message: "Pick 1 map for MD1 or 3 maps for MD3" } });
      }
      const active = await database.findActiveServerMatch();
      if (active && !body.force) {
        return reply.code(409).send({ error: { code: "SERVER_BUSY", message: `Server busy with "${active.name}"` } });
      }
      if (active) {
        if (rcon) await sendRcon(rcon, "css_endmatch").catch(() => undefined);
        await database.setServerState(active.id, "finished");
        await database.setMatchPhase(active.id, "finished");
        publishMatch(active.id);
      }

      const teamAName = body.teamAName ?? "Time A";
      const teamBName = body.teamBName ?? "Time B";
      const input = resolveMatchInput({
        name: body.name ?? `Dinâmico ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}`,
        mapName: body.maps[0]!, teamAName, teamBName, maxRounds: body.maxRounds ?? 24, format: body.format, mapPool: body.maps,
        preset: body.preset,
        ...(body.knifeRound !== undefined ? { knifeRound: body.knifeRound } : {}),
        ...(body.overtime !== undefined ? { overtime: body.overtime } : {}),
        ...(body.overtimeRounds !== undefined ? { overtimeRounds: body.overtimeRounds } : {}),
        ...(body.playout !== undefined ? { playout: body.playout } : {}),
      });
      const admin = request.currentUser!;
      const match = await database.createMatch({ ...input, createdBy: admin.id });
      const names = new Map(connectedPlayers.map((p) => [p.steamId, p.name]));
      for (const [team, ids] of [["a", body.teamA], ["b", body.teamB]] as const) {
        for (const steamId of ids) {
          const user = await database.upsertSteamUser(steamId);
          const inGame = names.get(steamId);
          if (inGame && user.displayName.startsWith("Jogador ")) await database.updateUserProfile(steamId, inGame, user.avatarUrl);
          await database.joinMatch(match.id, user.id);
          await database.setPlayerTeam(match.id, user.id, team);
        }
      }
      for (const [i, mapName] of body.maps.entries()) {
        await database.insertVeto({
          matchId: match.id, seq: i + 1, action: "pick", mapName, team: null, actorSteamId: admin.steamId, actorName: "Decider",
        });
      }
      if (!input.knifeRound) await database.setMatchSide(match.id, "a");
      await database.setMatchPhase(match.id, "live");
      const created = await database.getMatchById(match.id);
      const result = created ? await loadOnServer(created) : { ok: false, error: "Match not found" };
      publishMatch(match.id);
      return reply.code(201).send({ matchId: match.id, loading: result.ok, error: result.error ?? null });
    },
  );

  app.delete("/api/matches/:id", { onRequest: requireStaff }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    if (request.currentUser!.role !== "superadmin") return reply.code(403).send(forbidden);
    const { id } = request.params as { id: string };
    const match = await database.getMatchById(id);
    if (!match) return reply.code(404).send(notFound);
    const onServer = ["loading", "warmup", "live", "paused", "map_end"].includes(match.serverState);
    if (onServer && rcon) await sendRcon(rcon, "css_endmatch").catch(() => undefined);
    await database.deleteMatch(id);
    publish({ type: "match", matchId: id });
    publish({ type: "matches" });
    return { deleted: true };
  });

  app.get("/api/plugin/matches/:number/config", { onRequest: requirePlugin }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const number = Number((request.params as { number: string }).number);
    const match = Number.isInteger(number) ? await database.getMatchByNumber(number) : null;
    if (!match || match.phase !== "live") return reply.code(404).send(notFound);
    const [players, vetoes] = await Promise.all([database.listMatchPlayers(match.id), database.listVetoes(match.id)]);
    return buildMatchzyConfig(match, players, vetoes, { eventsUrl: `${pluginApiUrl}/api/plugin/events`, pluginToken });
  });

  app.post("/api/plugin/events", { onRequest: requirePlugin, bodyLimit: 262144 }, async (request, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    const event = (request.body ?? {}) as Record<string, unknown>;
    const number = Number(event.matchid);
    if (!Number.isInteger(number) || number <= 0) return reply.code(202).send({ accepted: false });
    const previous = eventQueues.get(number) ?? Promise.resolve(false);
    const current = previous.catch(() => false).then(() => applyEvent(number, event));
    eventQueues.set(number, current);
    const accepted = await current;
    if (eventQueues.get(number) === current) eventQueues.delete(number);
    return reply.code(202).send({ accepted });
  });

  const eventQueues = new Map<number, Promise<boolean>>();
  const applyEvent = async (number: number, event: Record<string, unknown>) => {
    if (!database) return false;
    const match = await database.getMatchByNumber(number);
    if (!match) return false;
    const [players, vetoes] = await Promise.all([database.listMatchPlayers(match.id), database.listVetoes(match.id)]);
    const teamBySteamId = new Map(players.map((p) => [p.steamId, p.team]));
    const result = applyMatchzyEvent(match.live, match.serverState, event, (steamId) => teamBySteamId.get(steamId) ?? null);
    const maps = seriesMaps(match, vetoes);
    const currentMap = result.live.mapNumber !== undefined ? maps[result.live.mapNumber] : undefined;
    if (currentMap) result.live.mapName = currentMap;
    await database.setLive(match.id, result.live);
    if (result.state !== match.serverState) await database.setServerState(match.id, result.state);
    if (result.seriesFinished) await database.setMatchPhase(match.id, "finished");
    publishMatch(match.id);
    return true;
  };

  app.register(async (instance) => {
    instance.get("/api/ws", { websocket: true, onRequest: [requireSameOrigin, requireUser] }, (socket) => {
      const send = (event: RealtimeEvent | { type: "hello" | "ping" }) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
      };
      send({ type: "hello" });
      const unsubscribe = bus.subscribe(send);
      let alive = true;
      socket.on("pong", () => { alive = true; });
      const heartbeat = setInterval(() => {
        if (!alive) return socket.terminate();
        alive = false;
        socket.ping();
        send({ type: "ping" });
      }, 15000);
      socket.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
      socket.on("error", () => socket.terminate());
    });
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
      publish({ type: "invites" });
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
    publish({ type: "invites" });
    publish({ type: "matches" });
    return { responded: true };
  });

  app.get("/api/staff/users", { onRequest: requireStaff }, async (_, reply) => {
    if (!database) return reply.code(503).send(databaseUnavailable);
    return { users: await database.listUsers() };
  });

  app.post(
    "/api/staff/users/:steamId/role",
    {
      onRequest: requireStaff,
      schema: {
        params: { type: "object", required: ["steamId"], properties: { steamId: { type: "string", pattern: "^[0-9]{17}$" } } },
        body: { type: "object", additionalProperties: false, required: ["role"], properties: { role: { type: "string", enum: ["player", "admin"] } } },
      },
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send(databaseUnavailable);
      if (request.currentUser!.role !== "superadmin") return reply.code(403).send(forbidden);
      const { steamId } = request.params as { steamId: string };
      const { role } = request.body as { role: "player" | "admin" };
      const target = await database.findUserBySteamId(steamId);
      if (!target) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "User not found" } });
      if (target.role === "superadmin") return reply.code(409).send({ error: { code: "PROTECTED_USER", message: "Super admin role cannot be changed" } });
      await database.setUserRole(steamId, role);
      return { steamId, role };
    },
  );

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
      onRequest: requirePlugin,
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
      if (players) {
        lastPluginReportAt = Date.now();
        await setConnectedPlayers(players).catch((error) => request.log.warn(error, "Failed to record server players"));
      }
      return reply.code(202).send({ accepted: true, receivedAt: new Date().toISOString() });
    },
  );

  return app;
};
