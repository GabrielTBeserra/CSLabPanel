import { useEffect, useRef } from "react";
import { Badge, Box, Button, Flex, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import { serverStateLabel } from "./labels";
import { mapName, mapThumb } from "./maps";
import { play } from "./sound";
import type { LivePlayer, MatchRecord, ServerCommand } from "./services/api";

function Scoreboard({ title, side, players }: { title: string; side: "a" | "b"; players: LivePlayer[] }) {
  const sorted = [...players].sort((x, y) => y.kills - x.kills || x.deaths - y.deaths);
  return (
    <Box className={`scoreboard team-${side}`}>
      <Text className="team-side" fontFamily="mono" fontSize="xs" mb="2">{title}</Text>
      <table className="score-table">
        <thead>
          <tr><th>Jogador</th><th>K</th><th>D</th><th>A</th><th>HS%</th><th>DMG</th></tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={6} className="score-empty">Sem estatísticas ainda</td></tr>
          ) : sorted.map((p) => (
            <tr key={p.steamId}>
              <td className="score-name">{p.name}</td>
              <td>{p.kills}</td>
              <td>{p.deaths}</td>
              <td>{p.assists}</td>
              <td>{p.kills > 0 ? Math.round((p.headshotKills / p.kills) * 100) : 0}</td>
              <td>{p.damage}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

export default function LivePanel({
  match,
  connectAddress,
  canManage,
  isStaff,
  onLoad,
  onEnd,
  onCopy,
  onCommand,
}: {
  match: MatchRecord;
  connectAddress: string | null;
  canManage: boolean;
  isStaff: boolean;
  onLoad: () => void;
  onEnd: () => void;
  onCopy: (text: string) => void;
  onCommand: (action: ServerCommand, round?: number) => void;
}) {
  const live = match.live;
  const players = live.players ?? [];
  const scoreA = live.scoreA ?? 0;
  const scoreB = live.scoreB ?? 0;
  const state = match.serverState;
  const onServer = ["loading", "warmup", "live", "paused", "map_end"].includes(state);

  const lastScore = useRef(`${scoreA}-${scoreB}`);
  const lastState = useRef(state);
  const lastKill = useRef(live.feed?.[0]?.at);
  useEffect(() => {
    const key = `${scoreA}-${scoreB}`;
    if (key !== lastScore.current) play("pick");
    else if (live.feed?.[0]?.at && live.feed[0].at !== lastKill.current) play("click");
    if (state !== lastState.current && (state === "live" || state === "finished")) play("start");
    lastScore.current = key;
    lastState.current = state;
    lastKill.current = live.feed?.[0]?.at;
  }, [scoreA, scoreB, state, live.feed]);

  return (
    <Stack className="panel-card live-panel rise-in" gap="5" p="5">
      <Flex align="center" gap="3" justify="space-between" wrap="wrap">
        <HStack gap="3" wrap="wrap">
          <Text className="card-kicker" fontFamily="mono" fontSize="xs">PARTIDA NO SERVIDOR</Text>
          <Badge className={`server-state is-${state}`}>{serverStateLabel[state]}</Badge>
          {live.mapName ? <Text fontFamily="mono" fontSize="xs">{mapName(live.mapName)} · ROUND {live.round ?? 0}</Text> : null}
        </HStack>
        <HStack gap="2" wrap="wrap">
          {canManage && (state === "idle" || state === "error") && match.phase === "live" ? (
            <Button className="primary-button" onClick={onLoad} size="xs">{state === "error" ? "TENTAR DE NOVO" : "CARREGAR NO SERVIDOR"}</Button>
          ) : null}
          {isStaff && onServer && state !== "loading" ? (
            <>
              {state === "warmup" ? <Button className="primary-button" onClick={() => onCommand("forcestart")} size="xs">FORÇAR INÍCIO</Button> : null}
              {state === "live" ? <Button className="ghost-button" onClick={() => onCommand("pause")} size="xs">PAUSAR</Button> : null}
              {state === "paused" ? <Button className="primary-button" onClick={() => onCommand("unpause")} size="xs">DESPAUSAR</Button> : null}
              {state === "live" || state === "paused" ? (
                <Button
                  className="ghost-button"
                  onClick={() => {
                    const value = window.prompt("Restaurar qual round? (o round atual é " + (live.round ?? 0) + ")", String(Math.max((live.round ?? 1) - 1, 0)));
                    if (value !== null && /^\d+$/.test(value.trim())) onCommand("restore", Number(value.trim()));
                  }}
                  size="xs"
                >RESTAURAR ROUND</Button>
              ) : null}
            </>
          ) : null}
          {isStaff && onServer ? (
            <Button className="danger-button" onClick={onEnd} size="xs">ENCERRAR NO SERVIDOR</Button>
          ) : null}
        </HStack>
      </Flex>

      {match.serverError && state === "error" ? <Box className="notice is-error" p="3"><Text fontSize="sm">{match.serverError}</Text></Box> : null}

      <Flex
        align="center"
        className={`live-score${state === "live" ? " is-live" : ""}`}
        justify="space-between"
        px={{ base: "4", md: "8" }}
        py="5"
        style={live.mapName ? { ["--match-art" as string]: `url(${mapThumb(live.mapName, 3)})` } : undefined}
      >
        <Box textAlign="left">
          <Text className="team-side team-a-text" fontFamily="mono" fontSize="xs">TIME A</Text>
          <Text className="live-team">{match.teamAName}</Text>
          {match.format === "bo3" ? <Text fontFamily="mono" fontSize="xs">MAPAS {live.seriesA ?? 0}</Text> : null}
        </Box>
        <Text className="live-digits" key={`${scoreA}-${scoreB}`}>
          <span className="score-a">{scoreA}</span>
          <span className="live-sep">:</span>
          <span className="score-b">{scoreB}</span>
        </Text>
        <Box textAlign="right">
          <Text className="team-side team-b-text" fontFamily="mono" fontSize="xs">TIME B</Text>
          <Text className="live-team">{match.teamBName}</Text>
          {match.format === "bo3" ? <Text fontFamily="mono" fontSize="xs">MAPAS {live.seriesB ?? 0}</Text> : null}
        </Box>
      </Flex>

      {live.winner ? (
        <Box className="winner-banner" p="4" textAlign="center">
          <Text fontWeight="bold">VITÓRIA · {live.winner === "a" ? match.teamAName : match.teamBName} venceu a partida</Text>
        </Box>
      ) : null}

      {connectAddress && onServer ? (
        <Flex align="center" className="connect-box" gap="3" p="4" wrap="wrap">
          <Box flex="1" minW="200px">
            <Text className="card-kicker" fontFamily="mono" fontSize="xs">CONECTAR NO SERVIDOR</Text>
            <Text fontFamily="mono" fontWeight="bold" mt="1">connect {connectAddress}</Text>
            <Text className="admin-subtitle" fontSize="xs" mt="1">
              {state === "warmup" ? "Entre, vá para o seu time e digite .ready no chat." : "Só os jogadores escalados conseguem entrar; cada um cai no próprio time."}
            </Text>
          </Box>
          <HStack gap="2">
            <Button className="ghost-button" onClick={() => onCopy(`connect ${connectAddress}`)} size="sm">COPIAR</Button>
            <Button asChild className="primary-button" size="sm">
              <a href={`steam://rungameid/730//+connect%20${connectAddress}`}>ENTRAR NO JOGO</a>
            </Button>
          </HStack>
        </Flex>
      ) : null}

      <Grid gap="4" templateColumns={{ base: "1fr", lg: "1fr 1fr" }}>
        <Scoreboard players={players.filter((p) => p.team === "a")} side="a" title={match.teamAName} />
        <Scoreboard players={players.filter((p) => p.team === "b")} side="b" title={match.teamBName} />
      </Grid>

      <Box>
        <Text className="card-kicker" fontFamily="mono" fontSize="xs" mb="2">KILL FEED</Text>
        {(live.feed ?? []).length === 0 ? (
          <Text className="admin-subtitle" fontSize="sm">Nenhum abate ainda.</Text>
        ) : (
          <Stack gap="1">
            {(live.feed ?? []).map((k) => (
              <Flex align="center" className="kill-row" gap="2" key={`${k.at}-${k.victim}`} px="3" py="1">
                <Text className={`kill-name team-${k.attackerTeam ?? "x"}-text`}>{k.attacker ?? "Mundo"}</Text>
                <Text className="kill-weapon" fontFamily="mono" fontSize="xs">{k.weapon || "—"}{k.headshot ? " · HS" : ""}</Text>
                <Text className={`kill-name team-${k.victimTeam ?? "x"}-text`}>{k.victim}</Text>
                <Text className="kill-round" fontFamily="mono" fontSize="xs" ml="auto">R{k.round}</Text>
              </Flex>
            ))}
          </Stack>
        )}
      </Box>

      {(live.maps ?? []).length > 0 ? (
        <HStack gap="2" wrap="wrap">
          {(live.maps ?? []).map((m, i) => (
            <Badge className="state-badge" key={`${m.mapName}-${i}`}>
              {mapName(m.mapName)} {m.scoreA}:{m.scoreB}
            </Badge>
          ))}
        </HStack>
      ) : null}
    </Stack>
  );
}
