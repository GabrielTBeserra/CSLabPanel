import { useCallback, useEffect, useState } from "react";
import { Badge, Box, Button, Flex, Heading, HStack, Stack, Text } from "@chakra-ui/react";
import {
  getMatch,
  inviteToMatch,
  sendVeto,
  setTeam,
  startVeto,
  type MatchPlayer,
  type MatchRecord,
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
  players,
  myUserId,
  canJoin,
  onJoin,
}: {
  title: string;
  players: MatchPlayer[];
  myUserId: string;
  canJoin: boolean;
  onJoin: () => void;
}) {
  const amIn = players.some((p) => p.userId === myUserId);
  return (
    <Box className="panel-card team-panel" flex="1" p="4">
      <Flex align="center" justify="space-between" mb="3">
        <Heading as="h3" size="sm">{title}</Heading>
        <Badge className="state-badge">{players.length}/5</Badge>
      </Flex>
      <Stack gap="2">
        {players.map((p) => (
          <Flex className={p.userId === myUserId ? "room-player is-me" : "room-player"} justify="space-between" key={p.userId} px="3" py="2">
            <Text fontSize="sm">{p.displayName}</Text>
            <Text fontFamily="mono" fontSize="xs">{p.steamId.slice(-6)}</Text>
          </Flex>
        ))}
        {players.length === 0 ? <Text className="admin-subtitle">Aguardando jogadores…</Text> : null}
      </Stack>
      {canJoin && !amIn ? (
        <Button className="primary-button" mt="3" onClick={onJoin} size="sm" w="full">ENTRAR NESTE TIME</Button>
      ) : null}
    </Box>
  );
}

export default function MatchRoom({ matchId, user, onBack }: { matchId: string; user: UserRecord; onBack: () => void }) {
  const [match, setMatch] = useState<MatchRecord | null>(null);
  const [feedback, setFeedback] = useState("");
  const [inviteSteamId, setInviteSteamId] = useState("");
  const [captainSteamId, setCaptainSteamId] = useState("");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const { match: m } = await getMatch(matchId, signal);
      if (!signal?.aborted) setMatch(m);
    } catch {
      if (!signal?.aborted) setFeedback("Não foi possível carregar a sala.");
    }
  }, [matchId]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(), 10000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); setFeedback(ok); await refresh(); }
    catch { setFeedback("Ação não permitida agora."); }
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
  const isCreator = match.createdBy === user.id;

  return (
    <Stack gap="5" mx="auto" maxW="1100px">
      <Flex align="center" justify="space-between" wrap="wrap" gap="3">
        <Box>
          <Button className="ghost-button" mb="2" onClick={onBack} size="xs">← LOBBY</Button>
          <Heading as="h1" size="xl">{match.name}</Heading>
          <Text fontFamily="mono" fontSize="xs" mt="1">
            {match.format.toUpperCase()} · MR{match.maxRounds} · {match.id.slice(0, 8)}
          </Text>
        </Box>
        <Badge className={`match-status is-${match.phase}`}>{phaseLabel[match.phase]}</Badge>
      </Flex>

      {feedback ? <Box className="notice" p="4"><Text>{feedback}</Text></Box> : null}

      <Flex className="room-teams" gap="4" wrap={{ base: "wrap", md: "nowrap" }}>
        <TeamPanel
          canJoin={match.phase === "lobby"}
          myUserId={user.id}
          onJoin={() => void act(() => setTeam(match.id, "a"), "Você entrou no Time A.")}
          players={teamA}
          title={match.teamAName}
        />
        <Flex align="center" className="room-vs" justify="center" minW="48px">
          <Text fontFamily="mono" fontSize="lg">VS</Text>
        </Flex>
        <TeamPanel
          canJoin={match.phase === "lobby"}
          myUserId={user.id}
          onJoin={() => void act(() => setTeam(match.id, "b"), "Você entrou no Time B.")}
          players={teamB}
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
              <HStack gap="2" ml="auto">
                <input
                  aria-label="SteamID64 do capitão B"
                  onChange={(e) => setCaptainSteamId(e.target.value)}
                  placeholder="Capitão B (opcional)"
                  value={captainSteamId}
                />
                <Button
                  className="primary-button"
                  onClick={() => void act(() => startVeto(match.id, STEAM_ID64.test(captainSteamId) ? captainSteamId : undefined), "Veto iniciado.")}
                  size="sm"
                >INICIAR VETO</Button>
              </HStack>
            ) : null}
          </Flex>
        </Box>
      ) : null}

      {match.phase === "veto" || match.phase === "live" ? (
        <Box className="panel-card" p="5">
          <Text className="card-kicker" fontFamily="mono" fontSize="xs">VETO DE MAPAS</Text>
          <VetoBoard match={match} onAction={(action) => void act(() => sendVeto(match.id, action), "Veto registrado.")} user={user} />
        </Box>
      ) : null}
    </Stack>
  );
}
