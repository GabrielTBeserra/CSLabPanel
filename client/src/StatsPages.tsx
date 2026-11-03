import { useEffect, useState } from "react";
import { Badge, Box, Button, Flex, Grid, Heading, HStack, Image, Stack, Text } from "@chakra-ui/react";
import { mapName, mapThumb } from "./maps";
import {
  getHistory,
  getPlayerProfile,
  getRankings,
  type HistoryEntry,
  type PlayerProfile,
  type RankingEntry,
} from "./services/api";

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);
const kd = (k: number, d: number) => (d > 0 ? (k / d).toFixed(2) : k.toFixed(2));
const adr = (damage: number, rounds: number) => (rounds > 0 ? Math.round(damage / rounds) : 0);
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function LevelBadge({ level, elo }: { level: number; elo?: number }) {
  return (
    <HStack className={`level-badge lvl-${level}`} gap="2">
      <span className="level-ring">{level}</span>
      {elo !== undefined ? <Text fontFamily="mono" fontSize="xs">{elo}</Text> : null}
    </HStack>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  return src ? <Image alt="" borderRadius="md" boxSize="9" src={src} /> : <Box className="avatar-fallback">{name.slice(0, 1).toUpperCase()}</Box>;
}

function PageHeader({ kicker, title, subtitle, onBack }: { kicker: string; title: string; subtitle: string; onBack: () => void }) {
  return (
    <Box>
      <Button className="ghost-button" mb="3" onClick={onBack} size="xs">← LOBBY</Button>
      <Text className="section-label" fontFamily="mono" fontSize="xs">{kicker}</Text>
      <Heading as="h1" className="admin-title" size="3xl">{title}</Heading>
      <Text className="admin-subtitle">{subtitle}</Text>
    </Box>
  );
}

export function HistoryList({ entries, onOpenMatch }: { entries: HistoryEntry[]; onOpenMatch: (id: string) => void }) {
  if (entries.length === 0) return <Box className="empty-state"><Text>Nenhuma partida finalizada ainda.</Text></Box>;
  return (
    <Stack gap="2">
      {entries.map((m) => {
        const result = m.player ? (m.player.won ? "win" : m.winner ? "loss" : "draw") : null;
        return (
          <button className={`history-row${result ? ` is-${result}` : ""}`} key={m.matchId} onClick={() => onOpenMatch(m.matchId)} style={{ ["--match-art" as string]: `url(${mapThumb(m.mapName.split(", ")[0] ?? m.mapName)})` }} type="button">
            <Box flex="1" minW="0" textAlign="left">
              <Text fontWeight="bold" truncate>{m.teamAName} <span className="score-a">{m.scoreA}</span> : <span className="score-b">{m.scoreB}</span> {m.teamBName}</Text>
              <Text className="admin-subtitle" fontFamily="mono" fontSize="xs" mt="0">
                {m.mapName.split(", ").map(mapName).join(" · ")} · {m.format === "bo3" ? "MD3" : "MD1"} · {when(m.finishedAt)}{m.mvpName ? ` · MVP ${m.mvpName}` : ""}
              </Text>
            </Box>
            {m.player ? (
              <HStack gap="3">
                <Text fontFamily="mono" fontSize="sm">{m.player.kills}/{m.player.deaths}/{m.player.assists}</Text>
                {m.player.eloDelta !== null ? <Badge className={`elo-delta ${m.player.eloDelta >= 0 ? "is-up" : "is-down"}`}>{m.player.eloDelta >= 0 ? "+" : ""}{m.player.eloDelta}</Badge> : null}
                <Badge className={`result-badge is-${result}`}>{result === "win" ? "VITÓRIA" : result === "loss" ? "DERROTA" : "EMPATE"}</Badge>
              </HStack>
            ) : null}
          </button>
        );
      })}
    </Stack>
  );
}

export function RankingPage({ onBack, onOpenPlayer }: { onBack: () => void; onOpenPlayer: (steamId: string) => void }) {
  const [rows, setRows] = useState<RankingEntry[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getRankings(controller.signal).then((r) => setRows(r.rankings), () => setRows([]));
    return () => controller.abort();
  }, []);
  return (
    <Stack gap="5" mx="auto" maxW="1100px">
      <PageHeader kicker="COMPETITIVO" onBack={onBack} subtitle="Classificação por ELO. Só aparece quem já terminou uma partida." title="Ranking" />
      <Box className="panel-card" overflowX="auto" p="4">
        {rows === null ? <Text className="admin-subtitle">Carregando…</Text> : rows.length === 0 ? (
          <Box className="empty-state"><Text>Ninguém ranqueado ainda. Termine uma partida para aparecer aqui.</Text></Box>
        ) : (
          <table className="score-table ranking-table">
            <thead><tr><th>#</th><th>Jogador</th><th>Nível</th><th>Partidas</th><th>Vitórias</th><th>K/D</th><th>ADR</th><th>HS%</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr className={r.position && r.position <= 3 ? `is-top${r.position}` : undefined} key={r.steamId} onClick={() => onOpenPlayer(r.steamId)}>
                  <td>{r.position}</td>
                  <td className="score-name"><HStack gap="3"><Avatar name={r.displayName} src={r.avatarUrl} /><span>{r.displayName}</span></HStack></td>
                  <td><LevelBadge elo={r.elo} level={r.level} /></td>
                  <td>{r.matches}</td>
                  <td>{pct(r.wins, r.matches)}%</td>
                  <td>{kd(r.kills, r.deaths)}</td>
                  <td>{adr(r.damage, r.rounds)}</td>
                  <td>{pct(r.headshotKills, r.kills)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Box>
    </Stack>
  );
}

export function HistoryPage({ onBack, onOpenMatch }: { onBack: () => void; onOpenMatch: (id: string) => void }) {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getHistory(undefined, controller.signal).then((r) => setRows(r.matches), () => setRows([]));
    return () => controller.abort();
  }, []);
  return (
    <Stack gap="5" mx="auto" maxW="1100px">
      <PageHeader kicker="PARTIDAS" onBack={onBack} subtitle="Últimas partidas finalizadas no servidor." title="Histórico" />
      {rows === null ? <Text className="admin-subtitle">Carregando…</Text> : <HistoryList entries={rows} onOpenMatch={onOpenMatch} />}
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Box className="panel-card stat-tile" p="4">
      <Text className="card-kicker" fontFamily="mono" fontSize="xs">{label}</Text>
      <Text className="stat-value">{value}</Text>
    </Box>
  );
}

function EloChart({ points }: { points: { elo: number }[] }) {
  if (points.length < 2) return <Text className="admin-subtitle" fontSize="sm">Jogue mais partidas para ver a evolução do ELO.</Text>;
  const values = points.map((p) => p.elo);
  const min = Math.min(...values) - 10;
  const max = Math.max(...values) + 10;
  const path = values.map((v, i) => `${(i / (values.length - 1)) * 100},${40 - ((v - min) / (max - min)) * 40}`).join(" ");
  return (
    <svg className="elo-chart" preserveAspectRatio="none" viewBox="0 0 100 40">
      <polyline fill="none" points={path} stroke="var(--chakra-colors-signal)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function PlayerPage({ steamId, onBack, onOpenMatch }: { steamId: string; onBack: () => void; onOpenMatch: (id: string) => void }) {
  const [data, setData] = useState<{ profile: PlayerProfile; recent: HistoryEntry[] } | null | "missing">(null);
  useEffect(() => {
    const controller = new AbortController();
    getPlayerProfile(steamId, controller.signal).then(setData, () => setData("missing"));
    return () => controller.abort();
  }, [steamId]);

  if (data === null) return <Text className="admin-subtitle" textAlign="center">Carregando perfil…</Text>;
  if (data === "missing") {
    return (
      <Box className="panel-card" mx="auto" maxW="560px" p="8">
        <Text className="admin-subtitle">Jogador não encontrado.</Text>
        <Button className="ghost-button" mt="4" onClick={onBack} size="xs">VOLTAR</Button>
      </Box>
    );
  }
  const { profile: p, recent } = data;
  return (
    <Stack gap="5" mx="auto" maxW="1100px">
      <Button alignSelf="flex-start" className="ghost-button" onClick={onBack} size="xs">← VOLTAR</Button>
      <Flex align="center" className="panel-card profile-hero rise-in" gap="5" p="6" wrap="wrap">
        {p.avatarUrl ? <Image alt="" borderRadius="xl" boxSize="24" src={p.avatarUrl} /> : <Box className="avatar-fallback profile-avatar">{p.displayName.slice(0, 1)}</Box>}
        <Box flex="1" minW="200px">
          <Text className="section-label" fontFamily="mono" fontSize="xs">PERFIL</Text>
          <Heading as="h1" className="admin-title" size="3xl">{p.displayName}</Heading>
          <Text className="admin-subtitle" fontFamily="mono" fontSize="xs">{p.steamId}</Text>
        </Box>
        <Stack align="center" gap="1">
          <LevelBadge level={p.level} />
          <Text fontFamily="mono" fontWeight="bold">{p.elo} ELO</Text>
        </Stack>
      </Flex>

      <Grid gap="3" templateColumns={{ base: "repeat(2, 1fr)", md: "repeat(6, 1fr)" }}>
        <Stat label="PARTIDAS" value={p.matches} />
        <Stat label="VITÓRIAS" value={`${pct(p.wins, p.matches)}%`} />
        <Stat label="K/D" value={kd(p.kills, p.deaths)} />
        <Stat label="ADR" value={adr(p.damage, p.rounds)} />
        <Stat label="HS%" value={`${pct(p.headshotKills, p.kills)}%`} />
        <Stat label="MVPs" value={p.mvps} />
      </Grid>

      <Grid gap="5" templateColumns={{ base: "1fr", lg: "1fr 1fr" }}>
        <Box className="panel-card" p="5">
          <Text className="card-kicker" fontFamily="mono" fontSize="xs" mb="3">EVOLUÇÃO DO ELO</Text>
          <EloChart points={p.eloHistory} />
        </Box>
        <Box className="panel-card" p="5">
          <Text className="card-kicker" fontFamily="mono" fontSize="xs" mb="3">MAPAS</Text>
          {p.maps.length === 0 ? <Text className="admin-subtitle" fontSize="sm">Sem partidas ainda.</Text> : (
            <Stack gap="2">
              {p.maps.map((m) => (
                <Flex align="center" className="map-stat-row" gap="3" key={m.mapName} style={{ ["--match-art" as string]: `url(${mapThumb(m.mapName.split(", ")[0] ?? m.mapName)})` }}>
                  <Text flex="1" fontWeight="bold">{m.mapName.split(", ").map(mapName).join(" · ")}</Text>
                  <Text fontFamily="mono" fontSize="sm">{m.matches} partidas · {pct(m.wins, m.matches)}% vit.</Text>
                </Flex>
              ))}
            </Stack>
          )}
        </Box>
      </Grid>

      <Box>
        <Text className="card-kicker" fontFamily="mono" fontSize="xs" mb="3">ÚLTIMAS PARTIDAS</Text>
        <HistoryList entries={recent} onOpenMatch={onOpenMatch} />
      </Box>
    </Stack>
  );
}
