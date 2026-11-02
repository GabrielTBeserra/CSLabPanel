# CS Home Lab — Nova Base

## Direção

Recriar o painel web e a integração do servidor a partir de uma base limpa:

- `client/`: React, TypeScript e Chakra UI.
- `server/`: Fastify e TypeScript; API mínima para health e heartbeat autenticado do plugin.
- `plugin/MatchZy/`: clone adaptado do MatchZy upstream, com a origem e o commit-base registrados.
- PostgreSQL: pool no backend e readiness check; banco de produção provisionado no Coolify.
- Coolify: serviços web e API separados, configurados para receber domínios e segredos fora do código.

Esta fase entrega somente a fundação técnica. O usuário definirá telas, fluxos, comandos de jogo, regras de partida, dados e demais funcionalidades depois que a base estiver pronta. Não presumir nem implementar esses requisitos antes dessa definição.

## Transição

- Os diretórios locais antigos `client/` e `server/` e o bundle `deploy-cs2-manager.tar.gz` foram removidos sem migração dos dados.
- Os containers dos três painéis antigos (`cs2-match-manager`, `cs2-panel` e Get5) foram removidos. Os dados persistidos do Get5 permanecem em `/opt/get5-panel/data`.
- O plugin HomelabManager foi descarregado e removido do diretório de plugins do servidor CS2.
- Pelican, Wings, o servidor CS2, Metamod, CounterStrikeSharp e o MatchZy 0.9.1 original permanecem preservados. O MatchZy original só será substituído após o fork compilar e passar pelo smoke test.

## Sequência de trabalho

1. Fechar e testar a base visual Chakra UI, a API e o contrato mínimo de heartbeat.
2. Clonar MatchZy, verificar licença/origem/commit e adaptar somente o mínimo para a integração inicial.
3. Compilar contra a versão instalada de CounterStrikeSharp/.NET; validar carregamento e funcionamento do servidor.
4. Preparar e testar os containers separados para frontend e backend.
5. Aguardar a lista de funcionalidades do usuário antes de construir comportamento de produto.

## Deploy

O projeto `CSLabPanel` e o banco PostgreSQL estão criados no Coolify. Os Dockerfiles e o Compose local ficam no repositório. O remoto GitHub `GabrielTBeserra/CSLabPanel` está vazio; as aplicações web/API serão criadas e implantadas após a primeira publicação autorizada do monorepo. Configurar domínios exatos para frontend/API, `WEB_ORIGIN`, `DATABASE_URL` e `PLUGIN_TOKEN` no Coolify; não incluir valores secretos no frontend ou no repositório.
