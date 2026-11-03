import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Box, Button, Flex, Grid, Heading, HStack, Image, Stack, Text } from "@chakra-ui/react";
import { MapCard } from "./App";
import { serverStateLabel } from "./labels";
import { DEFAULT_POOL, MAPS, mapName } from "./maps";
import { PRESETS, describeRules, presetById, type PresetRules } from "./presets";
import { useRealtime } from "./realtime";
import { play } from "./sound";
import {
  getDynamicPlayers,
  startDynamicMatch,
  type DynamicPlayer,
  type MatchFormat,
  type MatchPreset,
  type ServerState,
} from "./services/api";

type Slot = "a" | "b" | null;

const shuffle = <T,>(items: T[]) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
};

function PlayerChip({ player, slot, onMove }: { player: DynamicPlayer; slot: Slot; onMove: (slot: Slot) => void }) {
  return (
    <Flex align="center" className={`room-player dyn-player${slot ? ` in-${slot}` : ""}`} gap="3" px="3" py="2">
      {player.avatarUrl ? (
        <Image alt="" borderRadius="md" boxSize="8" src={player.avatarUrl} />
      ) : (
        <Box className="avatar-fallback">{player.name.slice(0, 1).toUpperCase()}</Box>
      )}
      <Box flex="1" minW="0">
        <Text fontSize="sm" fontWeight="bold" truncate>{player.name}</Text>
        <Text className="admin-subtitle" fontFamily="mono" fontSize="2xs" mt="0">{player.registered ? "CONTA NO SITE" : "SEM CONTA · SERÁ CRIADA"}</Text>
      </Box>
      <HStack gap="1">
        <button aria-label={`${player.name} para o Time A`} aria-pressed={slot === "a"} className={`slot-btn is-a${slot === "a" ? " is-on" : ""}`} onClick={() => onMove(slot === "a" ? null : "a")} type="button">A</button>
        <button aria-label={`${player.name} para o Time B`} aria-pressed={slot === "b"} className={`slot-btn is-b${slot === "b" ? " is-on" : ""}`} onClick={() => onMove(slot === "b" ? null : "b")} type="button">B</button>
      </HStack>
    </Flex>
  );
}

export default function DynamicMatch({ onBack, onStarted }: { onBack: () => void; onStarted: (matchId: string) => void }) {
  const [players, setPlayers] = useState<DynamicPlayer[]>([]);
  const [activeMatch, setActiveMatch] = useState<{ id: string; name: string; serverState: ServerState } | null>(null);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [preset, setPreset] = useState<MatchPreset>("official");
  const [rules, setRules] = useState<PresetRules>(presetById("official").rules!);
  const [format, setFormat] = useState<MatchFormat>("bo1");
  const [maps, setMaps] = useState<string[]>([]);
  const [teamAName, setTeamAName] = useState("Time A");
  const [teamBName, setTeamBName] = useState("Time B");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await getDynamicPlayers(signal);
      if (signal?.aborted) return;
      setPlayers(result.players);
      setActiveMatch(result.activeMatch);
      setLoaded(true);
    } catch {
      if (!signal?.aborted) setFeedback("Não foi possível consultar o servidor CS2.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(), 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh]);

  useRealtime(useCallback((event) => {
    if (event.type === "presence" || event.type === "matches") void refresh();
  }, [refresh]));

  const slotOf = (steamId: string): Slot => slots[steamId] ?? null;
  const teamA = players.filter((p) => slotOf(p.steamId) === "a");
  const teamB = players.filter((p) => slotOf(p.steamId) === "b");
  const benched = players.filter((p) => slotOf(p.steamId) === null);
  const neededMaps = format === "bo3" ? 3 : 1;
  const ready = teamA.length > 0 && teamB.length > 0 && maps.length === neededMaps;

  const missing = useMemo(() => {
    const issues: string[] = [];
    if (teamA.length === 0 || teamB.length === 0) issues.push("cada time precisa de pelo menos 1 jogador");
    if (maps.length !== neededMaps) issues.push(`escolha ${neededMaps === 1 ? "1 mapa" : "3 mapas"}`);
    return issues;
  }, [teamA.length, teamB.length, maps.length, neededMaps]);

  const move = (steamId: string, slot: Slot) => {
    play("click");
    setSlots((current) => ({ ...current, [steamId]: slot }));
  };

  const shuffleTeams = () => {
    play("start");
    const order = shuffle(players.map((p) => p.steamId));
    setSlots(Object.fromEntries(order.map((id, i) => [id, i % 2 === 0 ? "a" : "b"])));
  };

  const selectPreset = (id: MatchPreset) => {
    play("click");
    setPreset(id);
    const presetRules = presetById(id).rules;
    if (presetRules) setRules(presetRules);
  };

  const toggleMap = (map: string) => {
    play("click");
    setMaps((current) => {
      if (current.includes(map)) return current.filter((m) => m !== map);
      return neededMaps === 1 ? [map] : current.length < neededMaps ? [...current, map] : current;
    });
  };

  const randomMaps = () => {
    play("pick");
    setMaps(shuffle(DEFAULT_POOL).slice(0, neededMaps));
  };

  const start = async (force = false) => {
    setBusy(true);
    setFeedback("");
    try {
      const result = await startDynamicMatch({
        teamAName: teamAName.trim() || "Time A",
        teamBName: teamBName.trim() || "Time B",
        teamA: teamA.map((p) => p.steamId),
        teamB: teamB.map((p) => p.steamId),
        maps, format, preset, ...rules, force,
      });
      play("start");
      if (result.error) setFeedback(`Partida criada, mas o servidor respondeu: ${result.error}`);
      onStarted(result.matchId);
    } catch (error) {
      if (error instanceof Error && error.message === "SERVER_BUSY" && !force) {
        if (window.confirm(`O servidor está com a partida "${activeMatch?.name ?? "atual"}" carregada. Encerrar e iniciar a nova?`)) {
          setBusy(false);
          await start(true);
          return;
        }
        setFeedback("Início cancelado: o servidor continua com a partida atual.");
      } else {
        play("error");
        setFeedback("Não foi possível iniciar a partida.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="5" mx="auto" maxW="1200px">
      <Flex align="end" gap="3" justify="space-between" wrap="wrap">
        <Box>
          <Button className="ghost-button" mb="3" onClick={onBack} size="xs">← LOBBY</Button>
          <Text className="section-label" fontFamily="mono" fontSize="xs">SUPER ADMIN</Text>
          <Heading as="h1" className="admin-title" size="3xl">Dinâmico</Heading>
          <Text className="admin-subtitle">Monte uma partida com quem já está conectado no servidor e inicie em poucos cliques.</Text>
        </Box>
        <HStack gap="2" wrap="wrap">
          <Badge className={`server-state is-${players.length > 0 ? "live" : "idle"}`}>{players.length} NO SERVIDOR</Badge>
          {activeMatch ? <Badge className={`server-state is-${activeMatch.serverState}`}>{serverStateLabel[activeMatch.serverState]} · {activeMatch.name}</Badge> : null}
          <Button className="ghost-button" onClick={() => void refresh()} size="xs">ATUALIZAR</Button>
        </HStack>
      </Flex>

      {feedback ? <Box className="notice" p="4"><Text>{feedback}</Text></Box> : null}

      <Grid gap="5" templateColumns={{ base: "1fr", xl: "minmax(0, 1.2fr) minmax(340px, 0.8fr)" }}>
        <Stack gap="4">
          <Box className="panel-card" p="5">
            <Flex align="center" justify="space-between" mb="3" wrap="wrap" gap="2">
              <Box>
                <Text className="card-kicker" fontFamily="mono" fontSize="xs">1 · JOGADORES CONECTADOS</Text>
                <Text className="admin-subtitle" fontSize="sm" mt="1">Clique em A ou B para escalar. Clique de novo para tirar.</Text>
              </Box>
              <HStack gap="2">
                <Button className="ghost-button" disabled={players.length < 2} onClick={shuffleTeams} size="xs">SORTEAR TIMES</Button>
                <Button className="ghost-button" disabled={Object.keys(slots).length === 0} onClick={() => setSlots({})} size="xs">LIMPAR</Button>
              </HStack>
            </Flex>
            {!loaded ? (
              <Text className="admin-subtitle">Consultando o servidor…</Text>
            ) : players.length === 0 ? (
              <Box className="empty-state"><Text>Ninguém conectado no servidor agora. Os jogadores aparecem aqui assim que entrarem.</Text></Box>
            ) : (
              <Grid gap="2" templateColumns={{ base: "1fr", md: "1fr 1fr" }}>
                {players.map((p) => <PlayerChip key={p.steamId} onMove={(slot) => move(p.steamId, slot)} player={p} slot={slotOf(p.steamId)} />)}
              </Grid>
            )}
          </Box>

          <Grid gap="4" templateColumns={{ base: "1fr", md: "1fr 1fr" }}>
            {([["a", teamA, teamAName, setTeamAName], ["b", teamB, teamBName, setTeamBName]] as const).map(([side, list, name, setName]) => (
              <Box className={`panel-card team-panel team-${side}`} key={side} p="4">
                <Text className="team-side" fontFamily="mono" fontSize="xs">{side === "a" ? "TIME A" : "TIME B"} · {list.length}</Text>
                <input aria-label={`Nome do ${side === "a" ? "Time A" : "Time B"}`} className="team-name-input" maxLength={64} onChange={(e) => setName(e.target.value)} value={name} />
                <Stack gap="1" mt="2">
                  {list.length === 0 ? <Text className="admin-subtitle" fontSize="sm">Nenhum jogador escalado.</Text> : list.map((p) => (
                    <Text fontSize="sm" fontWeight="bold" key={p.steamId}>{p.name}</Text>
                  ))}
                </Stack>
              </Box>
            ))}
          </Grid>
          {benched.length > 0 && (teamA.length > 0 || teamB.length > 0) ? (
            <Text className="admin-subtitle" fontSize="sm">Fora da partida: {benched.map((p) => p.name).join(", ")} — serão expulsos quando a partida carregar.</Text>
          ) : null}
          <Box className="panel-card dyn-summary" p="5">
            <Text className="card-kicker" fontFamily="mono" fontSize="xs">4 · INICIAR</Text>
            <Text className="rules-summary" fontFamily="mono" fontSize="xs" mt="2">
              {format === "bo3" ? "MD3" : "MD1"} · {describeRules(rules)} · {teamA.length}v{teamB.length}
              {maps.length > 0 ? ` · ${maps.map(mapName).join(", ")}` : ""}
            </Text>
            {missing.length > 0 ? <Text className="admin-subtitle" fontSize="sm" mt="2">Falta: {missing.join(" e ")}.</Text> : null}
            <Button className="primary-button" disabled={!ready || busy} mt="4" onClick={() => void start()} size="lg" w="full">
              {busy ? "INICIANDO…" : "INICIAR PARTIDA NO SERVIDOR"}
            </Button>
          </Box>
        </Stack>

        <Stack gap="4">
          <Box className="panel-card" p="5">
            <Text className="card-kicker" fontFamily="mono" fontSize="xs">2 · MODO</Text>
            <Grid className="preset-grid" gap="2" mt="3">
              {PRESETS.filter((p) => p.id !== "custom").map((p) => (
                <button aria-pressed={preset === p.id} className={`preset-card${preset === p.id ? " is-active" : ""}`} key={p.id} onClick={() => selectPreset(p.id)} type="button">
                  <span className="preset-tag">{p.tag}</span>
                  <strong>{p.title}</strong>
                  <small>{p.description}</small>
                </button>
              ))}
            </Grid>
            <HStack gap="2" mt="3">
              {(["bo1", "bo3"] as const).map((f) => (
                <button aria-pressed={format === f} className={`preset-card format-card${format === f ? " is-active" : ""}`} key={f} onClick={() => { play("click"); setFormat(f); setMaps([]); }} type="button">
                  <strong>{f === "bo1" ? "MD1" : "MD3"}</strong>
                  <small>{f === "bo1" ? "1 mapa" : "3 mapas, melhor de 3"}</small>
                </button>
              ))}
            </HStack>
          </Box>

          <Box className="panel-card" p="5">
            <Flex align="center" justify="space-between" wrap="wrap" gap="2">
              <Text className="card-kicker" fontFamily="mono" fontSize="xs">3 · MAPA{neededMaps > 1 ? "S" : ""} ({maps.length}/{neededMaps})</Text>
              <Button className="ghost-button" onClick={randomMaps} size="xs">ALEATÓRIO</Button>
            </Flex>
            <Grid className="map-grid is-compact" gap="2" mt="3">
              {MAPS.map((map) => {
                const index = maps.indexOf(map);
                return (
                  <MapCard
                    compact
                    key={map}
                    label={index >= 0 ? (neededMaps > 1 ? `MAPA ${index + 1}` : "ESCOLHIDO") : undefined}
                    map={map}
                    onClick={() => toggleMap(map)}
                    state={index >= 0 ? "pick" : "off"}
                  />
                );
              })}
            </Grid>
          </Box>

        </Stack>
      </Grid>
    </Stack>
  );
}
