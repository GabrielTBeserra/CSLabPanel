import type { ServerState } from "./services/api";

export const serverStateLabel: Record<ServerState, string> = {
  idle: "AGUARDANDO SERVIDOR",
  loading: "CARREGANDO NO SERVIDOR",
  warmup: "AQUECIMENTO",
  live: "AO VIVO",
  paused: "PAUSADO",
  map_end: "FIM DO MAPA",
  finished: "ENCERRADA",
  error: "ERRO NO SERVIDOR",
};
