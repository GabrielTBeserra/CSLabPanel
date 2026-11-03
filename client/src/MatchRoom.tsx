import { useCallback, useEffect, useState } from "react";
import { Badge, Box, Button, Flex, Heading, HStack, Image, Stack, Text } from "@chakra-ui/react";
import LivePanel from "./LivePanel";
import { mapName, mapThumb } from "./maps";
import { describeRules, presetById } from "./presets";
import { useRealtime } from "./realtime";
import { play, type SoundName } from "./sound";
import {
  deleteMatch,
  endMatchOnServer,
  getMatch,
  loadMatchOnServer,
  inviteToMatch,
  isStaff,
  sendVeto,
  setTeam,
  shuffleTeams,
  startVeto,
  type MatchPlayer,
  type MatchRecord,
  type MatchResult,
  type UserRecord,
} from "./services/api";
import { VetoBoard } from "./App";

const STEAM_ID64 = /^\d{17}$/;

const phaseLabel: Record<string, string> = {
  lobby: "LOBBY",
  veto: "VETO",
  live: "AO VIVO",
  finished: "FINALIZADA",
};

function TeamPanel({
  title,
  side,
  players,
  myUserId,
  captainId,
  canJoin,
  onJoin,
}: {
  title: string;
  side: "a" | "b";
  players: MatchPlayer[];
  myUserId: string;
  captainId: string | null;
  canJoin: boolean;
  onJoin: () => void;
}) {
  const amIn = players.some((p) => p.userId === myUserId);
  const slots = Array.from({ length: Math.max(0, 5 - players.length) });
  return (
    <Box className={`panel-card team-panel team-${side}`} flex="1" p="4">
      <Flex align="center" justify="space-between" mb="3">
        <Box>
          <Text className="team-side" fontFamily="mono" fontSize="xs">{side === "a" ? "TIME A" : "TIME B"}</Text>
          <Heading as="h3" size="md">{title}</Heading>
        </Box>
        <Badge className="state-badge">{players.length}/5</Badge>
      </Flex>
      <Stack gap="2">
        {players.map((p, i) => (
          <Flex
            align="center"
            className={p.userId === myUserId ? "room-player is-me rise-in" : "room-player rise-in"}
            gap="3"
            key={p.userId}
            px="3"
            py="2"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            {p.avatarUrl ? (
              <Image alt="" borderRadius="md" boxSize="9" src={p.avatarUrl} />
            ) : (
              <Box className="avatar-fallback">{p.displayName.slice(0, 1).toUpperCase()}</Box>
            )}
            <Text flex="1" fontSize="sm" fontWeight="bold" truncate>{p.displayName}</Text>
            {p.userId === captainId ? <Badge className="captain-badge">CAPITÃO</Badge> : null}
          </Flex>
        ))}
        {slots.map((_, i) => (
          <Flex align="center" className="room-player is-empty" gap="3" key={`empty-${i}`} px="3" py="2">
            <Box className="avatar-fallback is-empty" />
            <Text className="admin-subtitle" fontSize="sm" mt="0">Vaga aberta</Text>
          </Flex>
        ))}
      </Stack>
      {canJoin && !amIn ? (
        <Button className="primary-button" mt="3" onClick={onJoin} size="sm" w="full">ENTRAR NESTE TIME</Button>
      ) : null}
    </Box>
  );
}

function ResultPanel({ match, result }: { match: MatchRecord; result: MatchResult }) {
  const mvp = result.players.find((p) => p.steamId === result.mvpSteamId);
  const teamName = (t: "a" | "b") => (t === "a" ? match.teamAName : match.teamBName);
  return (
    <Stack className="panel-card rise-in" gap="4" p="5">
      <Flex align="center" justify="space-between" wrap="wrap" gap="3">
        <Box>
          <Text className="card-kicker" fontFamily="mono" fontSize="xs">RESULTADO FINAL</Text>
          <Heading as="h2" size="lg" mt="1">
            {result.winner ? `${teamName(result.winner)} venceu` : "Empate"} · <span className="score-a">{result.scoreA}</span> : <span className="score-b">{result.scoreB}</span>
          </Heading>
        </Box>
        {mvp ? (
          <Box className="panel-card mvp-card" px="4" py="3">
            <Text className="card-kicker" fontFamily="mono" fontSize="xs">MVP DA PARTIDA</Text>
            <Text fontWeight="bold">{mvp.name} · {mvp.kills}/{mvp.deaths}/{mvp.assists}</Text>
          </Box>
        ) : null}
      </Flex>
      <Box overflowX="auto">
        <table className="score-table">
          <thead><tr><th>Jogador</th><th>Time</th><th>K</th><th>D</th><th>A</th><th>ADR</th><th>HS%</th><th>ELO</th></tr></thead>
          <tbody>
            {result.players.map((p) => {
              const delta = p.eloAfter !== null && p.eloBefore !== null ? p.eloAfter - p.eloBefore : null;
              return (
                <tr key={p.steamId}>
                  <td className="score-name">{p.name}{p.steamId === result.mvpSteamId ? " ★" : ""}</td>
                  <td className={`team-${p.team}-text`}>{teamName(p.team)}</td>
                  <td>{p.kills}</td>
                  <td>{p.deaths}</td>
                  <td>{p.assists}</td>
                  <td>{result.rounds > 0 ? Math.round(p.damage / result.rounds) : 0}</td>
                  <td>{p.kills > 0 ? Math.round((p.headshotKills / p.kills) * 100) : 0}</td>
                  <td className={delta === null ? "" : delta >= 0 ? "elo-up" : "elo-down"}>{delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Box>
    </Stack>
  );
}

export default function MatchRoom({ matchId, user, onBack }: { matchId: string; user: UserRecord; onBack: () => void }) {
  const [match, setMatch] = useState<MatchRecord | null>(null);
  const [connectAddress, setConnectAddress] = useState<string | null>(null);
  const [finalResult, setFinalResult] = useState<MatchResult | null>(null);
  const [feedback, setFeedback] = useState("");
  const [inviteSteamId, setInviteSteamId] = useState("");
  const [captainSteamId, setCaptainSteamId] = useState("");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await getMatch(matchId, signal);
      if (signal?.aborted) return;
      setMatch(result.match);
      setFinalResult(result.result);
      setConnectAddress(result.connectAddress);
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof Error && error.message === "NOT_FOUND") { setMatch(null); setFeedback("Esta sala não existe mais."); }
      else setFeedback("Não foi possível carregar a sala.");
    }
  }, [matchId]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(), 60000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh]);

  useRealtime(useCallback((event) => {
    if (event.type === "match" && event.matchId !== matchId) return;
    if (event.type === "match" || event.type === "matches") void refresh();
  }, [matchId, refresh]));

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => setFeedback("Copiado."), () => setFeedback(text));
  };

  const act = async (fn: () => Promise<unknown>, ok: string, sound: SoundName = "join") => {
    try { await fn(); play(sound); setFeedback(ok); await refresh(); }
    catch { play("error"); setFeedback("Ação não permitida agora."); }
  };

  if (!match) {
    return (
      <Box className="panel-card" mx="auto" maxW="560px" p="8">
        <Text className="admin-subtitle">{feedback || "Carregando sala…"}</Text>
        <Button className="ghost-button" mt="4" onClick={onBack} size="xs">VOLTAR</Button>
      </Box>
    );
  }

  const players = match.players ?? [];
  const teamA = players.filter((p) => p.team === "a");
  const teamB = players.filter((p) => p.team === "b");
  const unassigned = players.filter((p) => p.team === null);
  const isMember = players.some((p) => p.userId === user.id);
  const isCreator = match.createdBy === user.id || isStaff(user);
  const pickedMap = (match.vetoes ?? []).find((v) => v.action === "pick")?.mapName ?? null;
  const heroMap = pickedMap ?? match.mapPool[0] ?? match.mapName;

  return (
    <Stack gap="5" mx="auto" maxW="1100px">
      <Flex
        align="end"
        className="room-hero rise-in"
        gap="3"
        justify="space-between"
        p={{ base: "5", md: "7" }}
        style={{ ["--match-art" as string]: `url(${mapThumb(heroMap, 2)})` }}
        wrap="wrap"
      >
        <Box>
          <Button className="ghost-button" mb="3" onClick={onBack} size="xs">← LOBBY</Button>
          <Text className="section-label" fontFamily="mono" fontSize="xs">{pickedMap ? `MAPA · ${mapName(pickedMap)}` : "SALA DA PARTIDA"}</Text>
          <Heading as="h1" className="room-title" size="3xl">{match.name}</Heading>
          <Text fontFamily="mono" fontSize="xs" mt="1">
            {match.format === "bo3" ? "MD3" : "MD1"} · {presetById(match.preset).title.toUpperCase()} · {describeRules(match)}
          </Text>
        </Box>
        <HStack gap="2">
          <Button
            className="ghost-button"
            onClick={() => copy(`${window.location.origin}/match/${match.id}`)}
            size="xs"
          >COPIAR LINK</Button>
          <Badge className={`match-status is-${match.phase}`}>{phaseLabel[match.phase]}</Badge>
        </HStack>
      </Flex>

      {feedback ? <Box className="notice" p="4"><Text>{feedback}</Text></Box> : null}

      <Flex className="room-teams" gap="4" wrap={{ base: "wrap", md: "nowrap" }}>
        <TeamPanel
          canJoin={match.phase === "lobby"}
          captainId={match.captainAId}
          myUserId={user.id}
          onJoin={() => void act(() => setTeam(match.id, "a"), "Você entrou no Time A.")}
          players={teamA}
          side="a"
          title={match.teamAName}
        />
        <Flex align="center" className="room-vs" justify="center" minW="64px">
          <Text className="vs-mark">VS</Text>
        </Flex>
        <TeamPanel
          canJoin={match.phase === "lobby"}
          captainId={match.captainBId}
          myUserId={user.id}
          onJoin={() => void act(() => setTeam(match.id, "b"), "Você entrou no Time B.")}
          players={teamB}
          side="b"
          title={match.teamBName}
        />
      </Flex>

      {unassigned.length > 0 ? (
        <Box className="panel-card" p="4">
          <Text className="card-kicker" fontFamily="mono" fontSize="xs">SEM TIME</Text>
          <HStack gap="2" mt="2" wrap="wrap">
            {unassigned.map((p) => <Badge key={p.userId} className="state-badge">{p.displayName}</Badge>)}
          </HStack>
        </Box>
      ) : null}

      {match.phase === "lobby" ? (
        <Box className="panel-card" p="4">
          <Flex align="center" gap="3" wrap="wrap">
            {!isMember ? (
              <Button className="primary-button" onClick={() => void act(() => setTeam(match.id, "a"), "Você entrou na partida.")} size="sm">ENTRAR NA PARTIDA</Button>
            ) : null}
            {isMember ? (
              <>
                <Box className="field" flex="1" minW="220px">
                  <span>Convidar por SteamID64</span>
                  <input onChange={(e) => setInviteSteamId(e.target.value)} placeholder="7656119…" value={inviteSteamId} />
                </Box>
                <Button
                  className="ghost-button"
                  onClick={() => {
                    if (!STEAM_ID64.test(inviteSteamId)) { setFeedback("SteamID64 inválido."); return; }
                    void act(() => inviteToMatch(match.id, inviteSteamId), "Convite enviado.");
                  }}
                  size="sm"
                >CONVIDAR</Button>
              </>
            ) : null}
            {isCreator ? (
              <HStack gap="2" ml="auto" wrap="wrap">
                <Button
                  className="ghost-button"
                  onClick={() => void act(() => shuffleTeams(match.id), "Times sorteados.", "start")}
                  size="sm"
                >SORTEAR TIMES</Button>
                <input
                  aria-label="SteamID64 do capitão B"
                  onChange={(e) => setCaptainSteamId(e.target.value)}
                  placeholder="Capitão B (opcional)"
                  value={captainSteamId}
                />
                <Button
                  className="primary-button"
                  onClick={() => void act(() => startVeto(match.id, STEAM_ID64.test(captainSteamId) ? captainSteamId : undefined), "Veto iniciado.", "start")}
                  size="sm"
                >INICIAR VETO</Button>
              </HStack>
            ) : null}
          </Flex>
        </Box>
      ) : null}

      {finalResult ? <ResultPanel match={match} result={finalResult} /> : null}

      {match.phase === "live" || match.phase === "finished" ? (
        <LivePanel
          canManage={isCreator}
          connectAddress={connectAddress}
          isStaff={isStaff(user)}
          match={match}
          onCopy={copy}
          onEnd={() => {
            if (!window.confirm("Encerrar a partida no servidor CS2?")) return;
            void act(() => endMatchOnServer(match.id), "Partida encerrada no servidor.", "start");
          }}
          onLoad={() => void act(() => loadMatchOnServer(match.id), "Carregando a partida no servidor…", "start")}
        />
      ) : null}

      {match.phase !== "lobby" ? (
        <Box className="panel-card rise-in" p="5">
          <Text className="card-kicker" fontFamily="mono" fontSize="xs">VETO DE MAPAS</Text>
          <VetoBoard match={match} onAction={(action) => void act(() => sendVeto(match.id, action), "Veto registrado.", "click")} user={user} />
        </Box>
      ) : null}

      {user.role === "superadmin" ? (
        <Flex justify="flex-end">
          <Button
            className="danger-button"
            onClick={() => {
              if (!window.confirm(`Apagar a sala "${match.name}"? Isso não pode ser desfeito.`)) return;
              void deleteMatch(match.id).then(() => { play("ban"); onBack(); }, () => { play("error"); setFeedback("Não foi possível apagar a sala."); });
            }}
            size="sm"
          >APAGAR SALA</Button>
        </Flex>
      ) : null}
    </Stack>
  );
}
