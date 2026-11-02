export interface ApiHealth {
  status: "ok";
  service: string;
  timestamp: string;
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/+$/, "");

const parseApiHealth = (value: unknown): ApiHealth => {
  if (typeof value !== "object" || value === null) {
    throw new Error("Unexpected API response");
  }

  const payload = value as Record<string, unknown>;
  if (
    payload.status !== "ok" ||
    typeof payload.service !== "string" ||
    typeof payload.timestamp !== "string" ||
    Number.isNaN(Date.parse(payload.timestamp))
  ) {
    throw new Error("Unexpected API response");
  }

  return {
    status: "ok",
    service: payload.service,
    timestamp: payload.timestamp,
  };
};

export const getApiHealth = async (signal?: AbortSignal): Promise<ApiHealth> => {
  const response = await fetch(`${apiBaseUrl}/health`, {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) throw new Error("API request failed");
  return parseApiHealth(await response.json());
};
