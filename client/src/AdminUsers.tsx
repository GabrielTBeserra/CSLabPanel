import { useCallback, useEffect, useState } from "react";
import { Badge, Box, Button, Flex, Heading, HStack, Image, Stack, Text } from "@chakra-ui/react";
import { listUsers, roleLabel, setUserRole, type UserRecord } from "./services/api";

export default function AdminUsers({ user, onBack }: { user: UserRecord; onBack: () => void }) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [feedback, setFeedback] = useState("");
  const isSuperAdmin = user.role === "superadmin";

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await listUsers(signal);
      if (!signal?.aborted) setUsers(result.users);
    } catch {
      if (!signal?.aborted) setFeedback("Não foi possível carregar os usuários.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const changeRole = async (target: UserRecord, role: "player" | "admin") => {
    try {
      await setUserRole(target.steamId, role);
      setFeedback(`${target.displayName} agora é ${roleLabel[role]}.`);
      await refresh();
    } catch {
      setFeedback("Não foi possível alterar o cargo.");
    }
  };

  return (
    <Stack gap="5" mx="auto" maxW="900px">
      <Box>
        <Button className="ghost-button" mb="2" onClick={onBack} size="xs">← LOBBY</Button>
        <Text className="section-label" fontFamily="mono" fontSize="xs">ADMINISTRAÇÃO</Text>
        <Heading as="h1" size="xl">Usuários</Heading>
        <Text className="admin-subtitle">
          {isSuperAdmin ? "Promova ou remova administradores." : "Somente o super admin pode alterar cargos."}
        </Text>
      </Box>

      {feedback ? <Box className="notice" p="4"><Text>{feedback}</Text></Box> : null}

      <Stack gap="3">
        {users.map((u) => (
          <Box className="panel-card" key={u.id} p="4">
            <Flex align="center" justify="space-between" wrap="wrap" gap="3">
              <HStack gap="3">
                {u.avatarUrl ? <Image alt={u.displayName} borderRadius="full" boxSize="9" src={u.avatarUrl} /> : null}
                <Box>
                  <Text fontWeight="bold">{u.displayName}</Text>
                  <Text fontFamily="mono" fontSize="xs">{u.steamId}</Text>
                </Box>
              </HStack>
              <HStack gap="2">
                <Badge className={`state-badge ${u.role === "player" ? "" : "is-online"}`}>{roleLabel[u.role]}</Badge>
                {isSuperAdmin && u.role === "player" ? (
                  <Button className="primary-button" onClick={() => void changeRole(u, "admin")} size="xs">TORNAR ADMIN</Button>
                ) : null}
                {isSuperAdmin && u.role === "admin" ? (
                  <Button className="ghost-button" onClick={() => void changeRole(u, "player")} size="xs">REMOVER ADMIN</Button>
                ) : null}
              </HStack>
            </Flex>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}
