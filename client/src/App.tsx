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
  createAdminMatch,
  getApiHealth,
  listAdminMatches,
  type ApiHealth,
  type MatchRecord,
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

export default function App() {
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [adminToken, setAdminToken] = useState("");
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [form, setForm] = useState(initialForm);
  const [feedback, setFeedback] = useState("");
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const loadMatches = useCallback(async (token = adminToken.trim(), signal?: AbortSignal) => {
    if (!token) {
      setMatches([]);
      setFeedback("Informe o token administrativo para gerenciar partidas.");
      return false;
    }

    setIsLoadingMatches(true);
    try {
      const result = await listAdminMatches(token, signal);
      if (signal?.aborted) return false;
      setMatches(result.matches);
      setFeedback("");
      return true;
    } catch (error) {
      if (signal?.aborted) return false;
      setMatches([]);
      setFeedback(error instanceof Error && error.message === "UNAUTHORIZED" ? "Token administrativo inválido." : "Não foi possível carregar as partidas.");
      return false;
    } finally {
      if (!signal?.aborted) setIsLoadingMatches(false);
    }
  }, [adminToken]);

  useEffect(() => {
    const controller = new AbortController();
    getApiHealth(controller.signal)
      .then((result) => {
        setHealth(result);
        setConnection("online");
      })
      .catch(() => {
        if (!controller.signal.aborted) setConnection("offline");
      });
    return () => controller.abort();
  }, []);


  const summary = useMemo(
    () => ({
      total: matches.length,
      scheduled: matches.filter((match) => match.status === "scheduled").length,
      live: matches.filter((match) => match.status === "live").length,
    }),
    [matches],
  );

  const submitMatch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCreating(true);
    setFeedback("");

    try {
      const result = await createAdminMatch(adminToken.trim(), {
        name: form.name.trim(),
        mapName: form.mapName,
        teamAName: form.teamAName.trim(),
        teamBName: form.teamBName.trim(),
        maxRounds: form.maxRounds,
      });
      setMatches((current) => [result.match, ...current]);
      setForm({ ...initialForm, mapName: form.mapName });
      setFeedback("Partida criada com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error && error.message === "UNAUTHORIZED" ? "Token administrativo inválido." : "Não foi possível criar a partida.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Box className="console-shell" minH="100vh" px={{ base: "4", md: "8" }}>
      <Flex align="center" className="topbar" justify="space-between" py="5" wrap="wrap" gap="4">
        <HStack align="center" gap="3">
          <Box aria-hidden="true" className="brand-mark">CS</Box>
          <Stack gap="0">
            <Text className="brand-name" fontSize="sm" fontWeight="bold">CS HOME LAB</Text>
            <Text className="brand-caption" fontFamily="mono" fontSize="xs">ADMIN / MATCH CONTROL</Text>
          </Stack>
        </HStack>
        <ConnectionSignal state={connection} />
      </Flex>

      <Box as="main" className="admin-frame" py="8">
        <Grid className="admin-layout" gap="5" templateColumns={{ base: "1fr", xl: "280px minmax(0, 1fr)" }}>
          <Stack className="admin-sidebar" gap="4">
            <Box className="panel-card" p="5">
              <Text className="card-kicker" fontFamily="mono" fontSize="xs">ACESSO</Text>
              <label className="field">
                <span>Token administrativo</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setAdminToken(event.target.value)}
                  placeholder="ADMIN_TOKEN"
                  type="password"
                  value={adminToken}
                />
              </label>
              <Button className="primary-button" disabled={isLoadingMatches} mt="4" onClick={() => void loadMatches()} size="sm">
                {isLoadingMatches ? "CARREGANDO" : "CONECTAR"}
              </Button>
            </Box>

            <Box className="panel-card" p="5">
              <Text className="card-kicker" fontFamily="mono" fontSize="xs">STATUS</Text>
              <Stack gap="3" mt="4">
                <Flex justify="space-between"><Text>API</Text><Badge className={`state-badge is-${connection}`}>{connection}</Badge></Flex>
                <Flex justify="space-between"><Text>Serviço</Text><Text fontFamily="mono">{health?.service ?? "—"}</Text></Flex>
                <Flex justify="space-between"><Text>Partidas</Text><Text fontFamily="mono">{summary.total}</Text></Flex>
                <Flex justify="space-between"><Text>Agendadas</Text><Text fontFamily="mono">{summary.scheduled}</Text></Flex>
                <Flex justify="space-between"><Text>Ao vivo</Text><Text fontFamily="mono">{summary.live}</Text></Flex>
              </Stack>
            </Box>
          </Stack>

          <Stack className="admin-content" gap="5">
            <Flex align="end" justify="space-between" wrap="wrap" gap="4">
              <Box>
                <Text className="section-label" fontFamily="mono" fontSize="xs">OPERAÇÃO</Text>
                <Heading className="admin-title" as="h1" size="3xl">Painel de partidas</Heading>
                <Text className="admin-subtitle">Crie e acompanhe partidas do servidor CS2.</Text>
              </Box>
              <Button className="ghost-button" disabled={isLoadingMatches || !adminToken} onClick={() => void loadMatches()} size="sm">
                ATUALIZAR LISTA
              </Button>
            </Flex>

            {feedback ? <Box className="notice" p="4"><Text>{feedback}</Text></Box> : null}

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
                  <Button className="primary-button" disabled={isCreating || !adminToken} mt="2" type="submit">
                    {isCreating ? "CRIANDO..." : "CRIAR PARTIDA"}
                  </Button>
                </form>
              </Box>

              <Box as="section" className="panel-card" p="6">
                <Flex align="center" justify="space-between" mb="4">
                  <Box>
                    <Text className="card-kicker" fontFamily="mono" fontSize="xs">REGISTROS</Text>
                    <Heading as="h2" size="lg" mt="2">Partidas</Heading>
                  </Box>
                  <Badge className="state-badge">{summary.total}</Badge>
                </Flex>

                {matches.length === 0 ? (
                  <Box className="empty-state"><Text>Nenhuma partida carregada.</Text></Box>
                ) : (
                  <Box className="match-table-wrap">
                    <table className="match-table">
                      <thead><tr><th>Partida</th><th>Mapa</th><th>Times</th><th>MR</th><th>Status</th></tr></thead>
                      <tbody>
                        {matches.map((match) => (
                          <tr key={match.id}>
                            <td>{match.name}</td>
                            <td>{match.mapName}</td>
                            <td>{match.teamAName} × {match.teamBName}</td>
                            <td>{match.maxRounds}</td>
                            <td><span className={`match-status is-${match.status}`}>{match.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Box>
                )}
              </Box>
            </Grid>
          </Stack>
        </Grid>
      </Box>

      <Flex as="footer" className="footer" justify="space-between" py="5" wrap="wrap" gap="3">
        <Text fontFamily="mono" fontSize="xs">CS HOME LAB / ADMIN</Text>
        <Text fontFamily="mono" fontSize="xs">API {health?.service ?? "—"}</Text>
      </Flex>
    </Box>
  );
}
