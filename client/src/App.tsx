import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  HStack,
  Stack,
  Text,
} from "@chakra-ui/react";
import {
  createMatch,
  getApiHealth,
  getMe,
  getPresence,
  inviteToMatch,
  joinMatch,
  listInvites,
  listMatches,
  logout,
  respondInvite,
  type InviteRecord,
  type MatchRecord,
  type PresenceEntry,
  type UserRecord,
} from "./services/api";

type ConnectionState = "checking" | "online" | "offline";

const maps = ["de_mirage", "de_inferno", "de_nuke", "de_ancient", "de_anubis", "de_vertigo", "de_overpass"];

const initialForm = {
  name: "",
  mapName: "de_mirage",
  teamAName: "Time A",
  teamBName: "Time B",
  maxRounds: 24,
};

function ConnectionSignal({ state }: { state: ConnectionState }) {
  return (
    <HStack className={`connection-signal is-${state}`} gap="2">
      <Box aria-hidden="true" className="signal-dot" />
      <Text fontFamily="mono" fontSize="xs" textTransform="uppercase">
        {state === "online" ? "API conectada" : state === "offline" ? "API indisponível" : "Verificando API"}
      </Text>
    </HStack>
  );
}

function PresenceList({ title, entries, empty }: { title: string; entries: PresenceEntry[]; empty: string }) {
  return (
    <Box className="panel-card" p="5">
      <Text className="card-kicker" fontFamily="mono" fontSize="xs">{title}</Text>
      {entries.length === 0 ? (
        <Text className="admin-subtitle" mt="3">{empty}</Text>
      ) : (
        <Stack gap="2" mt="3">
          {entries.map((entry) => (
            <Flex key={entry.steamId} justify="space-between">
              <Text>{entry.displayName}</Text>
              <Text fontFamily="mono" fontSize="xs">{entry.steamId.slice(-6)}</Text>
            </Flex>
          ))}
        </Stack>
      )}
    </Box>
  );
}

export default function App() {
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [user, setUser] = useState<UserRecord | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [siteOnline, setSiteOnline] = useState<PresenceEntry[]>([]);
  const [serverOnline, setServerOnline] = useState<PresenceEntry[]>([]);
  const [form, setForm] = useState(initialForm);
  const [feedback, setFeedback] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [inviteSteamId, setInviteSteamId] = useState("");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [matchResult, inviteResult, presence] = await Promise.all([
        listMatches(signal),
        listInvites(signal),
        getPresence(signal),
      ]);
      if (signal?.aborted) return;
      setMatches(matchResult.matches);
      setInvites(inviteResult.invites);
      setSiteOnline(presence.site);
      setServerOnline(presence.server);
    } catch {
      if (!signal?.aborted) setFeedback("Não foi possível carregar os dados.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getApiHealth(controller.signal)
      .then(() => setConnection("online"))
      .catch(() => { if (!controller.signal.aborted) setConnection("offline"); });
    getMe(controller.signal)
      .then((current) => {
        setUser(current);
        setUserLoaded(true);
        if (current) void refresh(controller.signal);
      })
      .catch(() => setUserLoaded(true));
    return () => controller.abort();
  }, [refresh]);

  const summary = useMemo(
    () => ({
      total: matches.length,
      site: siteOnline.length,
      server: serverOnline.length,
      invites: invites.length,
    }),
    [matches, siteOnline, serverOnline, invites],
  );

  const submitMatch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsBusy(true);
    setFeedback("");
    try {
      await createMatch({
        name: form.name.trim(),
        mapName: form.mapName,
        teamAName: form.teamAName.trim(),
        teamBName: form.teamBName.trim(),
        maxRounds: form.maxRounds,
      });
      setForm({ ...initialForm, mapName: form.mapName });
      setFeedback("Partida criada com sucesso.");
      await refresh();
    } catch {
      setFeedback("Não foi possível criar a partida.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleJoin = async (matchId: string) => {
    try {
      await joinMatch(matchId);
      setFeedback("Você entrou na partida.");
      await refresh();
    } catch {
      setFeedback("Não foi possível entrar na partida.");
    }
  };

  const handleInvite = async (matchId: string) => {
    if (!/^\d{17}$/.test(inviteSteamId)) {
      setFeedback("Informe um SteamID64 válido (17 dígitos).");
      return;
    }
    try {
      await inviteToMatch(matchId, inviteSteamId);
      setInviteSteamId("");
      setFeedback("Convite enviado.");
      await refresh();
    } catch {
      setFeedback("Não foi possível enviar o convite.");
    }
  };

  const handleRespond = async (inviteId: string, accept: boolean) => {
    try {
      await respondInvite(inviteId, accept);
      await refresh();
    } catch {
      setFeedback("Não foi possível responder ao convite.");
    }
  };

  const handleLogout = async () => {
    await logout().catch(() => undefined);
    setUser(null);
    setMatches([]);
    setInvites([]);
    setSiteOnline([]);
    setServerOnline([]);
  };

  return (
    <Box className="console-shell" minH="100vh" px={{ base: "4", md: "8" }}>
      <Flex align="center" className="topbar" justify="space-between" py="5" wrap="wrap" gap="4">
        <HStack align="center" gap="3">
          <Box aria-hidden="true" className="brand-mark">CS</Box>
          <Stack gap="0">
            <Text className="brand-name" fontSize="sm" fontWeight="bold">CS HOME LAB</Text>
            <Text className="brand-caption" fontFamily="mono" fontSize="xs">MATCH PLATFORM</Text>
          </Stack>
        </HStack>
        <HStack gap="4">
          <ConnectionSignal state={connection} />
          {user ? (
            <HStack gap="3">
              <Badge className="state-badge is-online">{user.displayName}</Badge>
              <Button className="ghost-button" onClick={() => void handleLogout()} size="xs">SAIR</Button>
            </HStack>
          ) : null}
        </HStack>
      </Flex>

      <Box as="main" className="admin-frame" py="8">
        {!userLoaded ? null : !user ? (
          <Box className="panel-card" mx="auto" maxW="560px" p="8" textAlign="center">
            <Text className="card-kicker" fontFamily="mono" fontSize="xs">LOGIN NECESSÁRIO</Text>
            <Heading as="h1" size="2xl" mt="3">Entre com sua Steam</Heading>
            <Text className="admin-subtitle" mt="3">
              Você precisa entrar com a Steam para criar partidas, receber convites e jogar.
            </Text>
            <Button asChild className="primary-button" mt="6" size="lg">
              <a href="/api/auth/steam">ENTRAR COM STEAM</a>
            </Button>
          </Box>
        ) : (
          <Grid className="admin-layout" gap="5" templateColumns={{ base: "1fr", xl: "280px minmax(0, 1fr)" }}>
            <Stack className="admin-sidebar" gap="4">
              <PresenceList title="ONLINE NO SITE" entries={siteOnline} empty="Ninguém online no site." />
              <PresenceList title="ONLINE NO CS2" entries={serverOnline} empty="Nenhum jogador reportado pelo plugin." />
              <Box className="panel-card" p="5">
                <Text className="card-kicker" fontFamily="mono" fontSize="xs">RESUMO</Text>
                <Stack gap="3" mt="4">
                  <Flex justify="space-between"><Text>Partidas</Text><Text fontFamily="mono">{summary.total}</Text></Flex>
                  <Flex justify="space-between"><Text>Site</Text><Text fontFamily="mono">{summary.site}</Text></Flex>
                  <Flex justify="space-between"><Text>CS2</Text><Text fontFamily="mono">{summary.server}</Text></Flex>
                  <Flex justify="space-between"><Text>Convites</Text><Text fontFamily="mono">{summary.invites}</Text></Flex>
                </Stack>
              </Box>
            </Stack>

            <Stack className="admin-content" gap="5">
              <Flex align="end" justify="space-between" wrap="wrap" gap="4">
                <Box>
                  <Text className="section-label" fontFamily="mono" fontSize="xs">PARTIDAS</Text>
                  <Heading className="admin-title" as="h1" size="3xl">Lobby</Heading>
                  <Text className="admin-subtitle">Crie partidas, convide jogadores pelo SteamID64 e entre nos jogos.</Text>
                </Box>
                <Button className="ghost-button" disabled={isBusy} onClick={() => void refresh()} size="sm">
                  ATUALIZAR
                </Button>
              </Flex>

              {feedback ? <Box className="notice" p="4"><Text>{feedback}</Text></Box> : null}

              {invites.length > 0 ? (
                <Box className="panel-card" p="5">
                  <Text className="card-kicker" fontFamily="mono" fontSize="xs">CONVITES PENDENTES</Text>
                  <Stack gap="3" mt="4">
                    {invites.map((invite) => (
                      <Flex key={invite.id} align="center" justify="space-between" wrap="wrap" gap="3">
                        <Text>{invite.inviterName} convidou você para <strong>{invite.matchName}</strong></Text>
                        <HStack gap="2">
                          <Button className="primary-button" onClick={() => void handleRespond(invite.id, true)} size="xs">ACEITAR</Button>
                          <Button className="ghost-button" onClick={() => void handleRespond(invite.id, false)} size="xs">RECUSAR</Button>
                        </HStack>
                      </Flex>
                    ))}
                  </Stack>
                </Box>
              ) : null}

              <Grid gap="5" templateColumns={{ base: "1fr", lg: "minmax(320px, 0.85fr) minmax(0, 1.15fr)" }}>
                <Box as="section" className="panel-card" p="6">
                  <Text className="card-kicker" fontFamily="mono" fontSize="xs">NOVA PARTIDA</Text>
                  <Heading as="h2" size="lg" mt="2">Criar partida</Heading>
                  <form className="match-form" onSubmit={submitMatch}>
                    <label className="field"><span>Nome</span><input required maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} value={form.name} /></label>
                    <label className="field"><span>Mapa</span><select onChange={(e) => setForm({ ...form, mapName: e.target.value })} value={form.mapName}>{maps.map((map) => <option key={map} value={map}>{map}</option>)}</select></label>
                    <Grid gap="3" templateColumns="1fr 1fr">
                      <label className="field"><span>Time A</span><input required maxLength={64} onChange={(e) => setForm({ ...form, teamAName: e.target.value })} value={form.teamAName} /></label>
                      <label className="field"><span>Time B</span><input required maxLength={64} onChange={(e) => setForm({ ...form, teamBName: e.target.value })} value={form.teamBName} /></label>
                    </Grid>
                    <label className="field"><span>Máximo de rounds</span><input min="1" max="30" onChange={(e) => setForm({ ...form, maxRounds: Number(e.target.value) })} type="number" value={form.maxRounds} /></label>
                    <Button className="primary-button" disabled={isBusy} mt="2" type="submit">
                      {isBusy ? "CRIANDO..." : "CRIAR PARTIDA"}
                    </Button>
                  </form>
                </Box>

                <Box as="section" className="panel-card" p="6">
                  <Flex align="center" justify="space-between" mb="4">
                    <Box>
                      <Text className="card-kicker" fontFamily="mono" fontSize="xs">PARTIDAS</Text>
                      <Heading as="h2" size="lg" mt="2">Disponíveis</Heading>
                    </Box>
                    <Badge className="state-badge">{summary.total}</Badge>
                  </Flex>

                  <Box className="field" mb="4">
                    <span>Convidar por SteamID64</span>
                    <input onChange={(e) => setInviteSteamId(e.target.value)} placeholder="7656119..." value={inviteSteamId} />
                  </Box>

                  {matches.length === 0 ? (
                    <Box className="empty-state"><Text>Nenhuma partida criada ainda.</Text></Box>
                  ) : (
                    <Stack gap="3">
                      {matches.map((match) => {
                        const isMember = match.players?.some((p) => p.userId === user.id) ?? false;
                        return (
                          <Box className="panel-card" key={match.id} p="4">
                            <Flex align="center" justify="space-between" wrap="wrap" gap="3">
                              <Box>
                                <Heading as="h3" size="md">{match.name}</Heading>
                                <Text fontFamily="mono" fontSize="xs">{match.mapName} · {match.teamAName} × {match.teamBName} · MR{match.maxRounds}</Text>
                                <Text fontSize="sm" mt="2">
                                  {match.players && match.players.length > 0
                                    ? `Jogadores: ${match.players.map((p) => p.displayName).join(", ")}`
                                    : "Sem jogadores ainda."}
                                </Text>
                              </Box>
                              <HStack gap="2">
                                <Badge className={`match-status is-${match.status}`}>{match.status}</Badge>
                                {!isMember ? (
                                  <Button className="primary-button" onClick={() => void handleJoin(match.id)} size="xs">ENTRAR</Button>
                                ) : (
                                  <Button className="ghost-button" onClick={() => void handleInvite(match.id)} size="xs">CONVIDAR</Button>
                                )}
                              </HStack>
                            </Flex>
                          </Box>
                        );
                      })}
                    </Stack>
                  )}
                </Box>
              </Grid>
            </Stack>
          </Grid>
        )}
      </Box>

      <Flex as="footer" className="footer" justify="space-between" py="5" wrap="wrap" gap="3">
        <Text fontFamily="mono" fontSize="xs">CS HOME LAB / MATCH PLATFORM</Text>
        <Text fontFamily="mono" fontSize="xs">LOGIN VIA STEAM OPENID</Text>
      </Flex>
    </Box>
  );
}
