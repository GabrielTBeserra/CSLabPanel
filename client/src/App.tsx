import { useCallback, useEffect, useState } from "react";
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
import { getApiHealth, type ApiHealth } from "./services/api";

type ConnectionState = "checking" | "online" | "offline";

const modules = [
  {
    code: "01",
    name: "Interface",
    description: "Base visual pronta para receber os fluxos do painel.",
    status: "ESTRUTURA",
  },
  {
    code: "02",
    name: "Backend",
    description: "API inicial com health check e contrato autenticado.",
    status: "API",
  },
  {
    code: "03",
    name: "Plugin CS",
    description: "Integração MatchZy será validada nesta fundação.",
    status: "EM PREPARAÇÃO",
  },
];

function ConnectionSignal({ state }: { state: ConnectionState }) {
  const label = {
    checking: "Verificando API",
    online: "API conectada",
    offline: "API indisponível",
  }[state];

  return (
    <HStack className={`connection-signal is-${state}`} gap="2">
      <Box aria-hidden="true" className="signal-dot" />
      <Text fontFamily="mono" fontSize="xs" textTransform="uppercase">
        {label}
      </Text>
    </HStack>
  );
}

export default function App() {
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshHealth = useCallback(async (signal?: AbortSignal) => {
    setIsRefreshing(true);

    try {
      const result = await getApiHealth(signal);
      if (signal?.aborted) return;
      setHealth(result);
      setConnection("online");
    } catch {
      if (signal?.aborted) return;
      setHealth(null);
      setConnection("offline");
    } finally {
      if (!signal?.aborted) setIsRefreshing(false);
    }
  }, []);

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

  const lastChecked = health
    ? new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(health.timestamp))
    : "—";

  return (
    <Box className="console-shell" minH="100vh" px={{ base: "5", md: "9" }}>
      <Flex align="center" className="topbar" justify="space-between" py="6">
        <HStack align="center" gap="3">
          <Box aria-hidden="true" className="brand-mark">
            CS
          </Box>
          <Stack gap="0">
            <Text className="brand-name" fontSize="sm" fontWeight="bold">
              CS HOME LAB
            </Text>
            <Text className="brand-caption" fontFamily="mono" fontSize="xs">
              CONTROL PLANE / 001
            </Text>
          </Stack>
        </HStack>

        <ConnectionSignal state={connection} />
      </Flex>

      <Box as="main" className="main-frame" pb="12" pt={{ base: "12", md: "20" }}>
        <Grid
          alignItems="end"
          className="hero-grid"
          gap={{ base: "10", lg: "16" }}
          templateColumns={{
            base: "1fr",
            lg: "minmax(0, 1.25fr) minmax(18rem, 0.75fr)",
          }}
        >
          <Stack className="hero-copy" gap="6">
            <HStack className="eyebrow" gap="3">
              <Text fontFamily="mono" fontSize="xs">
                FOUNDATION BUILD
              </Text>
              <Box aria-hidden="true" className="eyebrow-line" />
              <Text fontFamily="mono" fontSize="xs">
                00—01
              </Text>
            </HStack>

            <Heading className="hero-title" as="h1" size="4xl">
              O painel começa
              <br />
              <Box as="span" className="title-accent">
                pelo essencial.
              </Box>
            </Heading>

            <Text className="hero-description" maxW="38rem">
              Estrutura nova para conectar o painel ao servidor CS2. As
              funcionalidades serão definidas com você depois desta fundação.
            </Text>
          </Stack>

          <Box className="api-card" p={{ base: "5", md: "7" }}>
            <Flex align="start" justify="space-between">
              <Stack gap="1">
                <Text className="card-kicker" fontFamily="mono" fontSize="xs">
                  SERVICE / API
                </Text>
                <Heading as="h2" className="api-title" size="lg">
                  Backend base
                </Heading>
              </Stack>
              <Badge className={`state-badge is-${connection}`} variant="outline">
                {connection === "online"
                  ? "ONLINE"
                  : connection === "offline"
                    ? "OFFLINE"
                    : "CHECK"}
              </Badge>
            </Flex>

            <Box aria-hidden="true" className="api-visual">
              <Box className="api-visual-core" />
              <Box className="api-visual-ring ring-one" />
              <Box className="api-visual-ring ring-two" />
              <Text className="api-visual-label" fontFamily="mono" fontSize="xs">
                HTTP / READY
              </Text>
            </Box>

            <Flex align="center" justify="space-between" mt="5">
              <Text className="last-check" fontFamily="mono" fontSize="xs">
                ÚLTIMA CHECAGEM {lastChecked}
              </Text>
              <Button
                className="refresh-button"
                disabled={isRefreshing}
                onClick={() => void refreshHealth()}
                size="sm"
                variant="outline"
              >
                {isRefreshing ? "CHECANDO" : "ATUALIZAR"}
              </Button>
            </Flex>
          </Box>
        </Grid>

        <Box className="section-heading" mt={{ base: "16", md: "24" }} mb="5">
          <Text className="section-label" fontFamily="mono" fontSize="xs">
            COMPONENTES DA BASE
          </Text>
          <Box aria-hidden="true" className="section-rule" />
        </Box>

        <Grid
          className="module-grid"
          gap="3"
          templateColumns={{ base: "1fr", md: "repeat(3, minmax(0, 1fr))" }}
        >
          {modules.map((module) => (
            <Box className="module-card" key={module.code} p={{ base: "5", md: "6" }}>
              <Flex align="start" justify="space-between">
                <Text className="module-code" fontFamily="mono" fontSize="sm">
                  / {module.code}
                </Text>
                <Text className="module-status" fontFamily="mono" fontSize="xs">
                  {module.status}
                </Text>
              </Flex>
              <Heading as="h2" className="module-name" size="md" mt="10">
                {module.name}
              </Heading>
              <Text className="module-description" fontSize="sm" mt="2">
                {module.description}
              </Text>
            </Box>
          ))}
        </Grid>

        <Flex className="scope-note" align="center" gap="4" mt="8" p="5">
          <Text className="scope-index" fontFamily="mono" fontSize="sm">
            NEXT
          </Text>
          <Text className="scope-copy" fontSize="sm">
            A base está no lugar. O escopo de produto vem da próxima conversa.
          </Text>
        </Flex>
      </Box>

      <Flex as="footer" className="footer" justify="space-between" py="5">
        <Text fontFamily="mono" fontSize="xs">
          CS HOME LAB / NOVA BASE
        </Text>
        <Text fontFamily="mono" fontSize="xs">
          API {health?.service ?? "—"}
        </Text>
      </Flex>
    </Box>
  );
}
