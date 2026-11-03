import { useCallback, useEffect, useState } from "react";
import { Badge, Box, Button, Flex, Heading, HStack, Image, Stack, Text } from "@chakra-ui/react";
import { mapName, mapThumb } from "./maps";
import { play, type SoundName } from "./sound";
import {
  getMatch,
  inviteToMatch,
  isStaff,
  sendVeto,
  setTeam,
  shuffleTeams,
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
            {match.format === "bo3" ? "MD3" : "MD1"} · MR{match.maxRounds} · {match.id.slice(0, 8)}
          </Text>
        </Box>
        <HStack gap="2">
          <Button
            className="ghost-button"
            onClick={() => {
              const link = `${window.location.origin}/match/${match.id}`;
              void navigator.clipboard?.writeText(link).then(
                () => setFeedback("Link da sala copiado."),
                () => setFeedback(link),
              );
            }}
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

      {match.phase === "veto" || match.phase === "live" ? (
        <Box className="panel-card rise-in" p="5">
          <Text className="card-kicker" fontFamily="mono" fontSize="xs">VETO DE MAPAS</Text>
          <VetoBoard match={match} onAction={(action) => void act(() => sendVeto(match.id, action), "Veto registrado.", "click")} user={user} />
        </Box>
      ) : null}
    </Stack>
  );
}
