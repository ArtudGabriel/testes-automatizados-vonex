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
| **Playwright no WhatsApp Web — recusado** | Frágil (DOM da Meta muda), risco de ban, manutenção infinita. |
| **Asserção em 3 níveis** | Resposta de LLM é não-determinística. `contains`/`matches`/`maxLatencyMs` para o objetivo; `judge` (LLM-as-judge com rubrica) para o semântico. Judge sozinho é caro e ruidoso; determinístico sozinho não cobre. |
| **Modo `persona`** | Roteiro fixo só testa o caminho feliz. LLM no papel de cliente confuso caça o que roteiro não pega. Em troca, não é determinístico — exploração, não regressão. |
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
- **Claude API** — judge e persona (`claude-opus-5`, structured outputs). Só exigida por
  cenários que usam `judge` ou `persona`.

### Escopo da sessão atual

Entregue: CLI runner, dois adapters, graph sink, asserções determinísticas + judge, modo
persona, reporters console/JSON, 41 testes unitários.

Próximos, na ordem de valor:

1. **Spy nas conexões API da jornada** — hoje as asserções só enxergam o que a IA responde no
   WhatsApp. Se a jornada chama o CRM errado mas responde algo plausível, o teste passa. É o
   maior buraco de cobertura.
2. Modo de injeção de falha no sink (testar retry da plataforma).
3. `journey-tester-api` + `journey-tester-web` para histórico e dashboard.

### Particularidades / pegadinhas

- **Assinatura do webhook:** se a vonex.ai valida `X-Hub-Signature-256`, `WHATSAPP_APP_SECRET`
  precisa bater com o app secret dela, senão tudo volta 401.
- **Base URL da Cloud API** precisa ser configurável por ambiente na vonex.ai. É o único
  pré-requisito do adapter `http` do lado da plataforma.
- **Janela de 24h:** no adapter `cloud-api`, a primeira mensagem fora da janela volta com erro
  131047 da Meta. Precisa de template aprovado.
- **Não usar o número business pessoal** como número de teste automatizado.
- `stdout` é só relatório; log vai para `stderr` — é o que mantém `--json` pipeável.
- Nada de `setTimeout` arbitrário em teste: o runner espera o evento real, e os testes usam
  fake timers.

### Comandos

```bash
cd journey-tester-cli
npm install && cp .env.example .env
npm run dev -- run scenarios/agendamento-consulta.yaml
npm run dev -- validate scenarios/
npm test && npm run typecheck
```

---

*Estende o CLAUDE.md global. Detalhe de uso e limitações conhecidas em `journey-tester-cli/README.md`.*
