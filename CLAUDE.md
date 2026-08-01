# CLAUDE.md — testes-automatizados-vonex

**⚠️ Instrução inicial pro Claude Code:**
Leia primeiro o CLAUDE.md global (padrões globais). Este arquivo *estende* aquele com contexto
específico do projeto. Não duplicar padrões globais aqui.

---

### Projeto

- **Nome:** testes-automatizados-vonex
- **Propósito:** automatizar o teste de jornadas de IA no WhatsApp para o time de implantação.
  Hoje o teste é manual — a jornada é criada na plataforma **vonex.ai**, conectada a um número
  WhatsApp API oficial entregue ao cliente, e o implantador conversa com a IA a partir do
  próprio número business até fechar o ciclo de ajuste de prompt e das conexões API da jornada.
  O objetivo é substituir esse laço manual por cenários declarativos versionados.
- **Status atual:** v1 — CLI runner funcionando (roteiro fixo + persona simulada).

### Stack (divergências do default)

Não é NestJS nem Next.js: v1 é um **CLI Node + TypeScript**. Divergências deliberadas:

| Item | Default | Aqui | Motivo |
|---|---|---|---|
| Validação | class-validator | **Zod** | não há DTO de Nest; o que se valida é YAML de cenário |
| Config | ConfigService | `src/config/env.config.ts` | mesmo princípio (ponto único, validado), sem o container do Nest |
| Logger | Logger do Nest | `src/shared/logger.ts` | idem — nada de `console.log` solto |
| Persistência | Prisma + Postgres | nenhuma | v1 não guarda histórico; entra com a API |

O resto segue o default. Testes em **Jest**, naming e código em inglês, texto em PT-BR.

### Arquitetura específica

```
scenario.yaml ─▶ runner ─▶ adapter ─▶ jornada na vonex.ai
                    ▲                        │
                    └──── graph sink ◀───────┘
```

| Decisão | Trade-off |
|---|---|
| **Adapters de transporte plugáveis** | O mesmo cenário roda no webhook (CI, grátis) e no chip real (pré-go-live). Não se reescreve teste ao trocar de canal. |
| **Adapter `http` como padrão** | A jornada roda na vonex.ai, então dá para injetar o payload de webhook direto nela: determinístico, roda em CI, não gasta conversa com a Meta. Não cobre o canal em si. |
| **Graph sink** | A vonex.ai responde chamando a Cloud API de forma assíncrona — sem interceptar, o runner nunca veria a resposta. O sink finge ser o `graph.facebook.com`. Exige apontar a base URL da Cloud API do ambiente de teste para ele; se já é env var, zero mudança de código na plataforma. |
| **Adapter `cloud-api`** | Canal real. Custa por conversa e exige template aprovado para abrir a janela de 24h. Smoke test, não suíte de CI. |
| **API spy + stubs** | Mesmo truque do sink, aplicado às APIs que a jornada consome. Sem ele a asserção só vê o texto: jornada que responde "agendado!" sem chamar a agenda passa no teste. Os stubs ainda dão determinismo — a jornada para de depender do estado do banco de teste. Cobre só HTTP; fila e banco direto ficam de fora. |
| **Adapters não-oficiais (`z-api`, `evolution`, `uazapi`)** | Caminho quando **não dá para reconfigurar a vonex.ai** — que é o caso real do time. Um chip comum automatizado conversa com o número do bot: a jornada receptiva vê um cliente de verdade, sem template e sem janela de 24h, e a plataforma não é tocada. Em troca, API fora do ToS do WhatsApp, com risco de ban do chip conectado (aceito explicitamente pelo time) e sessão que cai. Captura por polling do chat, o que dispensa túnel público. |
| **Um adapter, três perfis de provedor** | Os três provedores fazem a mesma coisa com contratos HTTP diferentes. Um adapter por provedor triplicaria a lógica de polling, watermark e normalização. O perfil (`src/adapters/unofficial/provider.profile.ts`) declara só o que difere: auth, caminhos e corpo. Provedor novo é um bloco de config; contrato divergente se corrige por env, sem tocar em código. |
| **Playwright no WhatsApp Web — recusado** | Frágil (DOM da Meta muda), risco de ban, manutenção infinita. A Z-API cobre o mesmo caso com contrato de API estável em vez de DOM. |
| **Asserção em 3 níveis** | Resposta de LLM é não-determinística. `contains`/`matches`/`maxLatencyMs` para o objetivo; `judge` (LLM-as-judge com rubrica) para o semântico. Judge sozinho é caro e ruidoso; determinístico sozinho não cobre. |
| **Modo `persona` com arquétipos** | Roteiro fixo só testa o caminho feliz. LLM no papel de cliente caça o que roteiro não pega. Catálogo fechado de arquétipos (`ideal`, `confused`, `angry`, `wants-human`, `impatient`, `indecisive`, `distrustful`, `boundary-tester`) em vez de texto livre: cada um estressa a jornada por um ângulo diferente e é comparável entre implantações. `description` livre continua disponível para o que não cabe no catálogo. Em troca, não é determinístico — exploração, não regressão. |
| **Briefing do projeto obrigatório na persona** | Sem saber o que a jornada faz, o cliente simulado improvisa: inventa CPF quando pedem identificação e insiste em pedido fora do escopo. `projectFile` compartilha o briefing entre os cenários da implantação; `outOfScope` também vai para o judge, que passa a tratar recusa educada como acerto. |
| **CLI antes de API+web** | Menor caminho até valor. API NestJS + dashboard Next.js entram quando houver histórico que valha a pena olhar. |

### Regras de negócio chave

- **Um turno = todas as mensagens até `settleMs` de silêncio.** A IA quase sempre manda 2-3
  mensagens seguidas; tratar cada uma como turno faria toda asserção falhar à toa.
- **Cenário para no primeiro turno que falha** (default). Turno 3 não diz nada se o turno 1
  quebrou o fluxo. `--continue-on-failure` desliga.
- **Falha do judge conta como falha da asserção**, nunca como sucesso silencioso.
- **Exit code 1 em qualquer cenário reprovado** — é o contrato com o CI.

### Integrações

- **vonex.ai** — recebe o webhook simulado (`PLATFORM_WEBHOOK_URL`) e envia a resposta pela
  Cloud API (interceptada pelo sink). Ambiente de **teste**, nunca produção do cliente.
- **WhatsApp Cloud API (Meta)** — adapter `cloud-api`, número de teste dedicado.
- **Z-API / Evolution API / Uazapi** — adapters não-oficiais, chip de teste automatizado. Não
  exigem nada da vonex.ai, e são o caminho quando a plataforma não pode ser reconfigurada.
- **Claude API** — judge e persona (`claude-opus-5`, structured outputs). Só exigida por
  cenários que usam `judge` ou `persona`.

### Escopo da sessão atual

Entregue: CLI runner, cinco adapters (um deles com três perfis de provedor), graph sink, asserções determinísticas + judge, modo
persona com catálogo de arquétipos, briefing de projeto compartilhável, spy + stubs das APIs
externas, comando `doctor` de pré-voo, reporters console/JSON/JUnit, workflow de CI,
136 testes unitários.

Próximos, na ordem de valor:

1. **Primeira rodada real contra a vonex.ai** — nada rodou contra a plataforma de verdade
   ainda, só contra uma plataforma falsa. Judge, persona e o adapter `cloud-api` continuam
   sem execução real (falta `ANTHROPIC_API_KEY` e número de teste).
2. Modo de injeção de falha no sink (testar retry da plataforma).
3. Execução paralela de cenários (hoje sink e spy usam porta fixa).
4. `journey-tester-api` + `journey-tester-web` para histórico e dashboard.

### Particularidades / pegadinhas

- **Assinatura do webhook:** se a vonex.ai valida `X-Hub-Signature-256`, `WHATSAPP_APP_SECRET`
  precisa bater com o app secret dela, senão tudo volta 401.
- **Base URL da Cloud API** precisa ser configurável por ambiente na vonex.ai. É o único
  pré-requisito do adapter `http` do lado da plataforma. O mesmo vale para a base URL das
  APIs externas da jornada, se for usar o `apiSpy`.
- **Credencial em header nunca entra no relatório:** `authorization`, `x-api-key` e `cookie`
  são redigidos no spy antes de qualquer coisa ser gravada.
- **Janela de 24h:** no adapter `cloud-api`, a primeira mensagem fora da janela volta com erro
  131047 da Meta. Precisa de template aprovado.
- **Não usar o número business pessoal** como número de teste automatizado. No adapter
  `z-api` isso é crítico: o risco de ban recai sobre o chip conectado, então usar o número de
  trabalho significa perder a ferramenta de trabalho junto.
- **Shape varia entre provedores e versões.** São dois formatos: o plano da Z-API e o envelope
  Baileys do Evolution/Uazapi. O normalizador (`src/shared/unofficial-message.ts`) tolera as
  grafias conhecidas; divergência nova se corrige ali, num lugar só.
- **Nunca use o relógio do provedor como hora de chegada.** O `messageTimestamp` do Baileys vem
  em segundos: usá-lo como `receivedAt` produz latência negativa e faz `maxLatencyMs` passar
  falsamente. `receivedAt` é hora de observação; o relógio do provedor fica em
  `providerTimestamp`, só para deduplicar.
- **Latência no modo `poll` é cota superior**, não medida exata: inclui até um intervalo de
  polling. Para medir latência de verdade, use o adapter `http` ou captura por webhook.
- **`knownData` do briefing vai para a plataforma e para o modelo** — só dado fictício ali.
- **Arquétipo novo entra no catálogo** (`src/persona/archetypes.ts`), não como `description`
  copiada entre cenários: o valor está em ser comparável entre implantações.
- `stdout` é só relatório; log vai para `stderr` — é o que mantém `--json` pipeável.
- Nada de `setTimeout` arbitrário em teste: o runner espera o evento real, e os testes usam
  fake timers.

### Comandos

```bash
cd journey-tester-cli
npm install && cp .env.example .env
npm run dev -- doctor scenarios/       # checa config antes de rodar
npm run dev -- run scenarios/agendamento-consulta.yaml
npm run dev -- validate scenarios/
npm run dev -- personas -v
npm test && npm run typecheck
```

---

*Estende o CLAUDE.md global. Detalhe de uso e limitações conhecidas em `journey-tester-cli/README.md`.*
