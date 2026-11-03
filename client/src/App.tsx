import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  HStack,
  Image,
  Stack,
  Text,
} from "@chakra-ui/react";
import AdminUsers from "./AdminUsers";
import Backdrop from "./Backdrop";
import Logo from "./Logo";
import MatchRoom from "./MatchRoom";
import { DEFAULT_POOL, MAPS, mapIcon, mapName, mapThumb } from "./maps";
import { isMuted, onMutedChange, play, setMuted } from "./sound";
import {
  createMatch,
  isStaff,
  roleLabel,
  getApiHealth,
  getMe,
  getPresence,
  inviteToMatch,
  joinMatch,
  listInvites,
  listMatches,
  logout,
  respondInvite,
  sendVeto,
  startVeto,
  type InviteRecord,
  type MatchFormat,
  type MatchRecord,
  type PresenceEntry,
  type UserRecord,
} from "./services/api";

type ConnectionState = "checking" | "online" | "offline";

const STEAM_ID64 = /^\d{17}$/;

const initialForm = {
  name: "",
  teamAName: "Time A",
  teamBName: "Time B",
  maxRounds: 24,
  format: "bo1" as MatchFormat,
  mapPool: [...DEFAULT_POOL],
};

const phaseLabel: Record<string, string> = {
  lobby: "LOBBY",
  veto: "VETO",
  live: "AO VIVO",
  finished: "FINALIZADA",
};

const vetoStepsFor = (format: MatchFormat) =>
  format === "bo3"
    ? ["BAN A", "BAN B", "PICK A", "PICK B", "BAN A", "BAN B"]
    : ["BAN A", "BAN B", "BAN A", "BAN B", "BAN A", "BAN B"];

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

export function MapCard({
  map,
  state,
  label,
  actionable,
  intent,
  onClick,
  compact = false,
}: {
  map: string;
  state: "open" | "ban" | "pick" | "decider" | "off";
  label?: string;
  actionable?: boolean;
  intent?: "ban" | "pick";
  onClick?: () => void;
  compact?: boolean;
}) {
  return (
    <button
      className={`map-card is-${state}${actionable ? ` is-actionable intent-${intent ?? "pick"}` : ""}${compact ? " is-compact" : ""}`}
      disabled={!onClick}
      onClick={() => { play("click"); onClick?.(); }}
      type="button"
    >
      <span className="map-card-art" style={{ backgroundImage: `url(${mapThumb(map)})` }} />
      <span className="map-card-shade" />
      <img alt="" className="map-card-icon" loading="lazy" src={mapIcon(map)} />
      <span className="map-card-name">{mapName(map)}</span>
      {label ? <span className="map-card-tag">{label}</span> : null}
    </button>
  );
}

export function VetoBoard({ match, user, onAction }: { match: MatchRecord; user: UserRecord; onAction: (action: { action: "ban" | "pick"; mapName: string } | { action: "side"; side: "a" | "b" }) => void }) {
  const vetoes = match.vetoes ?? [];
  const pool = match.mapPool.length >= 3 ? match.mapPool : DEFAULT_POOL;
  const steps = vetoStepsFor(match.format);
  const stepIndex = vetoes.length;
  const currentStep = steps[stepIndex];
  const intent: "ban" | "pick" = currentStep?.startsWith("BAN") ? "ban" : "pick";
  const isMyTurn =
    stepIndex < steps.length &&
    ((currentStep?.endsWith("A") && user.id === match.captainAId) ||
      (currentStep?.endsWith("B") && user.id === match.captainBId));
  const isSideChoice = stepIndex >= steps.length;
  const isSideCaptain = user.id === (match.captainBId ?? match.captainAId);
  const byMap = new Map(vetoes.filter((v) => v.mapName).map((v) => [v.mapName!, v]));
  const teamName = (team: "a" | "b" | null) => (team === "a" ? match.teamAName : team === "b" ? match.teamBName : "");

  const vetoCount = vetoes.length;
  const lastAction = vetoes[vetoCount - 1]?.action;
  const lastCount = useRef(vetoCount);
  useEffect(() => {
    if (vetoCount > lastCount.current) play(lastAction === "ban" ? "ban" : lastAction === "side" ? "start" : "pick");
    lastCount.current = vetoCount;
  }, [vetoCount, lastAction]);

  return (
    <Box mt="4">
      <Flex align="center" className={`veto-turn${isMyTurn ? " is-mine" : ""}`} gap="3" mb="4" px="4" py="3" wrap="wrap">
        {!isSideChoice ? (
          <>
            <Badge className={`veto-chip is-${intent}`}>{currentStep}</Badge>
            <Text fontWeight="bold">
              {isMyTurn ? `Sua vez — escolha um mapa para ${intent === "ban" ? "banir" : "pickar"}` : "Aguardando o outro capitão…"}
            </Text>
          </>
        ) : match.sideChoice ? (
          <Text fontWeight="bold">Veto concluído — {teamName(match.sideChoice)} escolheu o lado.</Text>
        ) : (
          <Text fontWeight="bold">{isSideCaptain ? "Escolha qual time começa de CT" : "Aguardando escolha de lado…"}</Text>
        )}
        <Text className="veto-progress" fontFamily="mono" fontSize="xs" ml="auto">
          {Math.min(stepIndex, steps.length)}/{steps.length}
        </Text>
      </Flex>

      <Grid className="map-grid" gap="3">
        {pool.map((map) => {
          const veto = byMap.get(map);
          const state = !veto ? "open" : veto.action === "ban" ? "ban" : veto.actorName === "Decider" ? "decider" : "pick";
          const label = !veto ? undefined : state === "ban" ? `BAN · ${teamName(veto.team)}` : state === "decider" ? "DECIDER" : `PICK · ${teamName(veto.team)}`;
          return (
            <MapCard
              actionable={!veto && !isSideChoice && isMyTurn}
              intent={intent}
              key={map}
              label={label}
              map={map}
              onClick={!veto && !isSideChoice && isMyTurn ? () => onAction({ action: intent, mapName: map }) : undefined}
              state={state}
            />
          );
        })}
      </Grid>

      {isSideChoice && !match.sideChoice ? (
        <Grid gap="3" mt="4" templateColumns="1fr 1fr">
          <Button className="side-button is-ct" disabled={!isSideCaptain} onClick={() => onAction({ action: "side", side: "a" })}>
            {match.teamAName} começa CT
          </Button>
          <Button className="side-button is-t" disabled={!isSideCaptain} onClick={() => onAction({ action: "side", side: "b" })}>
            {match.teamBName} começa CT
          </Button>
        </Grid>
      ) : null}
    </Box>
  );
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const navigate = (to: string) => {
    window.history.pushState({}, "", to);
    setPath(to);
  };
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const roomMatch = /^\/match\/([0-9a-f-]{36})$/.exec(path)?.[1] ?? null;

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
  const [captainSteamId, setCaptainSteamId] = useState("");

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

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => void refresh(), 15000);
    return () => clearInterval(timer);
  }, [user, refresh]);

  const togglePoolMap = (map: string) => {
    setForm((current) => ({
      ...current,
      mapPool: current.mapPool.includes(map)
        ? current.mapPool.filter((m) => m !== map)
        : [...current.mapPool, map],
    }));
  };

  const submitMatch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsBusy(true);
    setFeedback("");
    try {
      const created = await createMatch({
        name: form.name.trim(),
        mapName: form.mapPool[0] ?? "de_mirage",
        teamAName: form.teamAName.trim(),
        teamBName: form.teamBName.trim(),
        maxRounds: form.maxRounds,
        format: form.format,
        mapPool: form.mapPool,
      });
      setForm(initialForm);
      setFeedback("Partida criada com sucesso.");
      await refresh();
      if (created.match) navigate(`/match/${created.match.id}`);
    } catch {
      setFeedback("Não foi possível criar a partida (pool precisa de 3+ mapas).");
    } finally {
      setIsBusy(false);
    }
  };

  const handleAction = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      play("join");
      setFeedback(ok);
      await refresh();
    } catch {
      play("error");
      setFeedback("Ação não permitida agora.");
    }
  };

  const [muted, setMutedState] = useState(isMuted());
  useEffect(() => onMutedChange(setMutedState), []);

  const inviteCount = useRef(0);
  useEffect(() => {
    if (invites.length > inviteCount.current) play("notify");
    inviteCount.current = invites.length;
  }, [invites]);

  const summary = useMemo(
    () => ({ total: matches.length, site: siteOnline.length, server: serverOnline.length }),
    [matches, siteOnline, serverOnline],
  );

  return (
    <Box className="console-shell" minH="100vh" px={{ base: "4", md: "8" }}>
      <Backdrop />
      <Flex align="center" className="topbar" justify="space-between" px={{ base: "4", md: "6" }} py="4" wrap="wrap" gap="4">
        <HStack align="center" gap="3">
          <Box as="button" aria-label="Ir para o lobby" className="brand-link" onClick={() => navigate("/")}>
            <Logo size={42} />
          </Box>
          <Stack gap="0">
            <Text className="brand-name" fontSize="sm" fontWeight="bold">CS HOME LAB</Text>
            <Text className="brand-caption" fontFamily="mono" fontSize="xs">MATCH PLATFORM</Text>
          </Stack>
        </HStack>
        <HStack gap="3" wrap="wrap">
          <ConnectionSignal state={connection} />
          <Button
            aria-label={muted ? "Ativar sons" : "Silenciar sons"}
            className="ghost-button"
            onClick={() => { setMuted(!muted); if (muted) play("click"); }}
            size="xs"
          >{muted ? "SOM: OFF" : "SOM: ON"}</Button>
          {user ? (
            <HStack gap="3" wrap="wrap">
              <HStack className="user-chip" gap="2">
                {user.avatarUrl ? (
                  <Image alt="" borderRadius="full" boxSize="7" src={user.avatarUrl} />
                ) : null}
                <Text fontSize="sm" fontWeight="bold">{user.displayName}</Text>
              </HStack>
              {isStaff(user) ? (
                <Button className="ghost-button" onClick={() => navigate("/admin")} size="xs">{roleLabel[user.role]}</Button>
              ) : null}
              <Button className="ghost-button" onClick={() => { void logout().catch(() => undefined); setUser(null); setMatches([]); setInvites([]); }} size="xs">SAIR</Button>
            </HStack>
          ) : null}
        </HStack>
      </Flex>

      <Box as="main" className="admin-frame" py="8">
        {!userLoaded ? null : !user ? (
          <Box className="panel-card login-card rise-in" mx="auto" maxW="560px" p="8" textAlign="center">
            <Flex justify="center" mb="5"><Logo size={76} /></Flex>
            <Text className="card-kicker" fontFamily="mono" fontSize="xs">LOGIN NECESSÁRIO</Text>
            <Heading as="h1" className="login-title" size="3xl" mt="3">Bora pro <span className="title-accent">servidor</span></Heading>
            <Text fontWeight="bold" mt="2">Entre com sua Steam</Text>
            <Text className="admin-subtitle" mt="3">
              Você precisa entrar com a Steam para criar partidas, receber convites e jogar.
            </Text>
            <Button asChild className="primary-button" mt="6" size="lg">
              <a href="/api/auth/steam">ENTRAR COM STEAM</a>
            </Button>
          </Box>
        ) : (
          roomMatch ? (
            <MatchRoom matchId={roomMatch} onBack={() => navigate("/")} user={user} />
          ) : path === "/admin" && isStaff(user) ? (
            <AdminUsers onBack={() => navigate("/")} user={user} />
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
                  <Flex justify="space-between"><Text>Convites</Text><Text fontFamily="mono">{invites.length}</Text></Flex>
                </Stack>
              </Box>
            </Stack>

            <Stack className="admin-content" gap="5">
              <Flex align="end" justify="space-between" wrap="wrap" gap="4">
                <Box>
                  <Text className="section-label" fontFamily="mono" fontSize="xs">PARTIDAS</Text>
                  <Heading className="admin-title" as="h1" size="3xl">Lobby</Heading>
                  <Text className="admin-subtitle">Crie partidas MD1/MD3, defina capitães e faça o veto de mapas.</Text>
                </Box>
                <Button className="ghost-button" disabled={isBusy} onClick={() => void refresh()} size="sm">ATUALIZAR</Button>
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
                          <Button className="primary-button" onClick={() => void handleAction(() => respondInvite(invite.id, true), "Convite aceito.")} size="xs">ACEITAR</Button>
                          <Button className="ghost-button" onClick={() => void handleAction(() => respondInvite(invite.id, false), "Convite recusado.")} size="xs">RECUSAR</Button>
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
                    <label className="field">
                      <span>Formato</span>
                      <select onChange={(e) => setForm({ ...form, format: e.target.value as MatchFormat })} value={form.format}>
                        <option value="bo1">MD1 — melhor de 1</option>
                        <option value="bo3">MD3 — melhor de 3</option>
                      </select>
                    </label>
                    <Box className="field">
                      <span>Pool de mapas ({form.mapPool.length})</span>
                      <Grid className="map-grid is-compact" gap="2" mt="1">
                        {MAPS.map((map) => (
                          <MapCard
                            compact
                            key={map}
                            label={form.mapPool.includes(map) ? "NO POOL" : undefined}
                            map={map}
                            onClick={() => togglePoolMap(map)}
                            state={form.mapPool.includes(map) ? "pick" : "off"}
                          />
                        ))}
                      </Grid>
                    </Box>
                    <Grid gap="3" templateColumns="1fr 1fr">
                      <label className="field"><span>Time A</span><input required maxLength={64} onChange={(e) => setForm({ ...form, teamAName: e.target.value })} value={form.teamAName} /></label>
                      <label className="field"><span>Time B</span><input required maxLength={64} onChange={(e) => setForm({ ...form, teamBName: e.target.value })} value={form.teamBName} /></label>
                    </Grid>
                    <label className="field"><span>Máximo de rounds</span><input min="1" max="30" onChange={(e) => setForm({ ...form, maxRounds: Number(e.target.value) })} type="number" value={form.maxRounds} /></label>
                    <Button className="primary-button" disabled={isBusy || form.mapPool.length < 3} mt="2" type="submit" w="full">
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

                  <Grid gap="3" mb="4" templateColumns="1fr 1fr">
                    <Box className="field">
                      <span>Convidar (SteamID64)</span>
                      <input onChange={(e) => setInviteSteamId(e.target.value)} placeholder="7656119..." value={inviteSteamId} />
                    </Box>
                    <Box className="field">
                      <span>Capitão B (SteamID64, opcional)</span>
                      <input onChange={(e) => setCaptainSteamId(e.target.value)} placeholder="7656119..." value={captainSteamId} />
                    </Box>
                  </Grid>

                  {matches.length === 0 ? (
                    <Box className="empty-state"><Text>Nenhuma partida criada ainda.</Text></Box>
                  ) : (
                    <Stack gap="3">
                      {matches.map((match, index) => {
                        const isMember = match.players?.some((p) => p.userId === user.id) ?? false;
                        const isCreator = match.createdBy === user.id || isStaff(user);
                        return (
                          <Box
                            className="panel-card match-card rise-in"
                            key={match.id}
                            p="4"
                            style={{
                              animationDelay: `${Math.min(index, 8) * 60}ms`,
                              ["--match-art" as string]: `url(${mapThumb((match.vetoes ?? []).find((v) => v.action === "pick")?.mapName ?? match.mapPool[0] ?? match.mapName)})`,
                            }}
                          >
                            <Flex align="center" justify="space-between" wrap="wrap" gap="3">
                              <Box>
                                <Heading as="h3" size="md">{match.name}</Heading>
                                <Text fontFamily="mono" fontSize="xs">
                                  {match.format === "bo3" ? "MD3" : "MD1"} · {match.teamAName} × {match.teamBName} · MR{match.maxRounds}
                                </Text>
                                <Text fontSize="sm" mt="2">
                                  {match.players && match.players.length > 0
                                    ? `Jogadores: ${match.players.map((p) => p.displayName).join(", ")}`
                                    : "Sem jogadores ainda."}
                                </Text>
                              </Box>
                              <HStack gap="2" wrap="wrap">
                                <Badge className={`match-status is-${match.phase}`}>{phaseLabel[match.phase]}</Badge>
                                <Button className="ghost-button" onClick={() => navigate(`/match/${match.id}`)} size="xs">SALA</Button>
                                {match.phase === "lobby" && !isMember ? (
                                  <Button className="primary-button" onClick={() => void handleAction(() => joinMatch(match.id), "Você entrou na partida.")} size="xs">ENTRAR</Button>
                                ) : null}
                                {match.phase === "lobby" && isMember ? (
                                  <Button
                                    className="ghost-button"
                                    onClick={() => {
                                      if (!STEAM_ID64.test(inviteSteamId)) { setFeedback("Informe um SteamID64 válido para convidar."); return; }
                                      void handleAction(() => inviteToMatch(match.id, inviteSteamId), "Convite enviado.");
                                    }}
                                    size="xs"
                                  >CONVIDAR</Button>
                                ) : null}
                                {match.phase === "lobby" && isCreator ? (
                                  <Button
                                    className="primary-button"
                                    onClick={() => void handleAction(() => startVeto(match.id, STEAM_ID64.test(captainSteamId) ? captainSteamId : undefined), "Veto iniciado.")}
                                    size="xs"
                                  >INICIAR VETO</Button>
                                ) : null}
                              </HStack>
                            </Flex>
                            {match.phase === "veto" || match.phase === "live" ? (
                              <VetoBoard match={match} onAction={(action) => void handleAction(() => sendVeto(match.id, action), "Veto registrado.")} user={user} />
                            ) : null}
                          </Box>
                        );
                      })}
                    </Stack>
                  )}
                </Box>
              </Grid>
            </Stack>
          </Grid>
        ))}
      </Box>

      <Flex as="footer" className="footer" justify="space-between" py="5" wrap="wrap" gap="3">
        <Text fontFamily="mono" fontSize="xs">CS HOME LAB / MATCH PLATFORM</Text>
        <Text fontFamily="mono" fontSize="xs">LOGIN VIA STEAM OPENID</Text>
      </Flex>
    </Box>
  );
}
