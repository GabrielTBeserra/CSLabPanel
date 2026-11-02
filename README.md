# CSLabPanel

CSLabPanel is the new CS Home Lab panel monorepo. The functional scope is intentionally limited to the technical foundation until the product owner defines the required screens, match flows, and server actions.

## Components

- `client/` — React, TypeScript, and Chakra UI panel shell.
- `server/` — Fastify API, PostgreSQL readiness check, and authenticated MatchZy heartbeat.
- `plugin/MatchZy/` — local-only MatchZy clone with the CS Home Lab heartbeat integration. It is excluded from this panel repository until the owner requests otherwise.

## Local development

Requirements: Node.js 24 or later and Docker Compose if running the local PostgreSQL container.

1. Copy `.env.example` to `.env`.
2. Set a strong `POSTGRES_PASSWORD` for the local database. `PLUGIN_TOKEN` can remain blank until the plugin is configured; when set, use a random secret of at least 32 characters.
3. Start the local stack with `docker compose up --build`.
4. Open the panel at `http://localhost:8080`.

The API exposes `GET /api/health` for process health and `GET /api/ready` for API/PostgreSQL readiness. The plugin heartbeat accepts `POST /api/plugin/heartbeat` with a bearer token. No match commands or product workflows are implemented yet.

For standalone development, run `npm run dev:server` and `npm run dev:client` from the repository root. The client dev server proxies `/api` to `localhost:3000`.

## Coolify

Deploy `client/Dockerfile` and `server/Dockerfile` as separate applications from the `main` branch. Set `VITE_API_BASE_URL` to the HTTPS API origin plus `/api` when the applications use separate domains; configure `WEB_ORIGIN` to the exact frontend origin and `DATABASE_URL` from the Coolify PostgreSQL resource. `PLUGIN_TOKEN` is optional until the local plugin is configured; set it as a secret before connecting a plugin. Do not expose the database publicly or put secret values in source control.

## Plugin environment

The MatchZy clone reads `CSHOME_PANEL_API_URL` (HTTPS origin only) and `CSHOME_PLUGIN_TOKEN` from the CS2 server process environment. The token must match `PLUGIN_TOKEN` on the API. The plugin remains local-only; deployment to the CS2 server waits for owner approval.
