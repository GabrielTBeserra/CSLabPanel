# Plugins do servidor CS2

## Estado de transição

- HomelabManager 1.6 foi descarregado e removido de `addons/counterstrikesharp/plugins/`.
- MatchZy 0.9.1 continua instalado e carregado como fallback enquanto o clone/fork é preparado e validado.
- Metamod:Source, CounterStrikeSharp, o contêiner do CS2, Pelican e Wings permanecem em execução.

## Nova integração

O plugin final é um clone local do upstream `https://github.com/shobhit-pathak/MatchZy.git`, tag `0.9.2`, commit `21c278070f9ef4eddcb0baf8f860a8e007271af6`. O upstream usa licença MIT; `LICENSE` e créditos originais permanecem no clone. O clone está fora do Git do painel por decisão do usuário.

Antes de implantar o fork:

1. confirmar a origem upstream e licença;
2. registrar o commit-base e preservar os avisos de licença;
3. compilar contra as versões instaladas no servidor;
4. testar o carregamento sem remover o MatchZy ativo;
5. substituir o MatchZy original somente após smoke test aprovado.

A fundação da API aceita heartbeat do plugin por HTTPS com bearer token. No processo do servidor CS2, configurar `CSHOME_PANEL_API_URL` como a origem HTTPS da API e `CSHOME_PLUGIN_TOKEN` com um token aleatório de pelo menos 32 caracteres. No Coolify, configurar o mesmo segredo como `PLUGIN_TOKEN` e o domínio do frontend como `WEB_ORIGIN`. O plugin envia somente versão e horário a cada 30 segundos; sem as variáveis corretas, ou sem HTTPS, o heartbeat permanece desativado.

Nenhum comando de jogo, evento de partida ou funcionalidade de produto será adicionado antes da especificação do usuário. Nenhuma credencial RCON deve ser enviada ao frontend ou ao endpoint de heartbeat.
