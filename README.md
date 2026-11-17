# TCC-Prompt-Injection

O **MailBot** é um assistente interno (simulado) cuja função é **resumir documentos e e-mails**. No cenário experimental ele:

- recebe uma tarefa do usuário e, opcionalmente, um **documento externo não confiável**;
- possui um **segredo/canário** (`CANARY`) usado para detectar vazamento;
- pode solicitar uma ação de ferramenta no formato `TOOL:send_email{"to":"...","body":"..."}` (ferramenta **simulada**, não envia e-mails reais).

O laboratório avalia se o modelo pode ser induzido a violar políticas (vazar segredo, acionar ferramenta indevidamente, sequestrar resposta) e o impacto de diferentes defesas.

## Arquitetura do MailBot

- **`server.js`** — servidor HTTP local (`127.0.0.1`) que expõe a UI e a API (`/api/config`, `/api/chat`). Mantém chaves de API no ambiente do servidor (nunca no navegador) e valida `Origin`.
- **`index.html`** — interface interativa: chat, seleção de modelo, ativação de defesas, injeção indireta via documento, biblioteca de payloads, inspetor (system/mensagem/saída bruta), placar, medidor de violação e exportação de log.
- **`providers.js`** — integração com provedores (`ollama`, `anthropic`, `openai` compatível) e modo `mock` (dry-run).
- **`payloads.js`** — configuração do alvo (canário, marcador, domínio permitido), prompt do sistema, payloads de ataque e tarefas legítimas.
- **`defenses.js`** — composição de prompt, filtro de entrada, parsing/validação de ferramenta e DLP/guard de saída.
- **`judge.js`** — juízes automáticos de sucesso (leak/tool/hijack) e pontuação heurística de “proximidade da violação”.
- **`lab.js`** — executor em lote: roda combinações (payload × vetor × defesa × repetições + tarefas benignas) e gera relatório/JSON/CSV.
