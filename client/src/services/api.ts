export interface ApiHealth {
  status: "ok";
  service: string;
  timestamp: string;
}

export interface MatchRecord {
  id: string;
  name: string;
  mapName: string;
  teamAName: string;
  teamBName: string;
  maxRounds: number;
  status: "scheduled" | "live" | "finished" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface CreateMatchInput {
  name: string;
  mapName: string;
  teamAName: string;
  teamBName: string;
  maxRounds: number;
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/+$/, "");

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const code = payload?.error?.code;
    throw new Error(code || "API request failed");
  }
  return response.json() as Promise<T>;
};

const parseApiHealth = (value: unknown): ApiHealth => {
  if (typeof value !== "object" || value === null) throw new Error("Unexpected API response");
  const payload = value as Record<string, unknown>;
  if (
    payload.status !== "ok" ||
    typeof payload.service !== "string" ||
    typeof payload.timestamp !== "string" ||
    Number.isNaN(Date.parse(payload.timestamp))
  ) {
    throw new Error("Unexpected API response");
  }
  return { status: "ok", service: payload.service, timestamp: payload.timestamp };
};

export const getApiHealth = async (signal?: AbortSignal): Promise<ApiHealth> =>
  parseApiHealth(await request<ApiHealth>("/health", { signal }));

export const listAdminMatches = async (token: string, signal?: AbortSignal) =>
  request<{ matches: MatchRecord[] }>("/admin/matches", {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });

export const createAdminMatch = async (token: string, input: CreateMatchInput) =>
  request<{ match: MatchRecord }>("/admin/matches", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
