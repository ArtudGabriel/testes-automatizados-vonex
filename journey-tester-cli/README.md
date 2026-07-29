# journey-tester-cli

Roda jornadas de IA do WhatsApp contra cenários declarativos, sem ninguém digitando no celular.

```bash
npm install
cp .env.example .env      # preencher PLATFORM_WEBHOOK_URL
npm run dev -- run scenarios/agendamento-consulta.yaml
```

Exit code `1` quando algum cenário falha — pronto para CI.

## Como funciona

```
scenario.yaml ─▶ runner ─▶ adapter ─▶ jornada na vonex.ai
                    ▲                        │
                    └──── graph sink ◀───────┘
                       (captura a resposta)
```

A plataforma responde ao cliente chamando a Cloud API da Meta de forma assíncrona. O
**graph sink** finge ser o `graph.facebook.com` e captura essa chamada — sem ele o runner
mandaria a mensagem e nunca veria a resposta.

### Os dois adapters

| | `http` (padrão) | `cloud-api` |
|---|---|---|
| Como injeta | POST do payload de webhook direto na vonex.ai | número de teste na Cloud API oficial |
| Como captura | graph sink local | webhook do número de teste (precisa de túnel público) |
| Custo | zero | conversa cobrada pela Meta + template aprovado para abrir a janela de 24h |
| Roda em CI | sim | não |
| Cobre o canal real | não (entrega, template, mídia ficam de fora) | sim |
| Quando usar | dia a dia, regressão, CI | smoke test antes do go-live |

Trocar de adapter não muda o cenário: `--adapter cloud-api` roda o mesmo YAML no canal real.

## Setup do adapter `http`

Duas variáveis fazem o trabalho:

1. **`PLATFORM_WEBHOOK_URL`** — o endpoint que recebe o webhook do WhatsApp no ambiente de
   **teste** da vonex.ai.
2. **Base URL da Cloud API na vonex.ai** — apontar para `http://127.0.0.1:4020` (o sink) no
   ambiente de teste. Se essa base URL já é uma env var na plataforma, não há mudança de código.

Se a plataforma valida `X-Hub-Signature-256`, preencha `WHATSAPP_APP_SECRET` com o mesmo app
secret — o runner assina o payload, senão a plataforma devolve 401.

## Anatomia de um cenário

```yaml
name: Agendamento de consulta — caminho feliz
adapter: http
contact:
  phone: "5511999999999"      # só dígitos, com DDI
  name: Maria Teste
replyTimeoutMs: 30000          # espera pela primeira mensagem do turno
settleMs: 2500                 # silêncio que fecha o turno

steps:
  - user: "oi, quero marcar uma consulta"
    expect:
      - maxLatencyMs: 8000
      - judge:
          criteria: cumprimentou e perguntou o motivo do contato
          mustNot: pediu CPF antes de entender o que o cliente quer

  - tapOption: "h_0900"        # clica num botão oferecido em turno anterior
    expect:
      - contains: "confirmada"
```

**Um turno = todas as mensagens até `settleMs` de silêncio.** A IA quase sempre manda 2-3
mensagens seguidas; agrupá-las evita asserção que falha à toa. É espera pelo evento real, não
`sleep` fixo.

### Asserções

| Asserção | O que faz |
|---|---|
| `contains: "texto"` | substring, ignorando acento e caixa |
| `notContains: "texto"` | o contrário — bom para caçar "não entendi", "erro", vazamento de prompt |
| `matches: "regex"` | regex case-insensitive sobre o turno inteiro |
| `maxLatencyMs: 8000` | tempo até a primeira mensagem |
| `messageCount: { min, max }` | pega IA tagarela ou muda |
| `judge: "critério"` | LLM-as-judge, para o que é semântico |
| `judge: { criteria, mustNot }` | idem, com condição proibida |

O texto avaliado inclui os títulos dos botões/lista (`[opções: 09:00 | 14:00]`), então dá para
asseverar sobre o que a IA ofereceu, não só sobre o que ela escreveu.

**Determinístico primeiro.** É grátis, instantâneo e não tem falso negativo. `judge` só onde a
resposta é livre — cada asserção dessas é uma chamada de LLM. Rubrica específica ("confirmou o
agendamento repetindo data e horário") produz muito menos ruído que rubrica vaga ("respondeu bem").

### Modo persona

Roteiro fixo só testa o caminho feliz. A persona põe um LLM no papel do cliente:

```yaml
persona:
  description: Homem de 60 anos, escreve tudo em minúsculo, muda de assunto no meio
  goal: Descobrir se precisa levar documento e remarcar a consulta
  firstMessage: "boa tarde preciso mudar minha consulta"
  maxTurns: 10
  expect:                       # avaliado sobre a conversa inteira
    - judge:
        criteria: tratou os dois pedidos do cliente
        mustNot: entrou em loop repetindo pergunta já respondida
```

A conversa para quando a persona considera o objetivo atingido, quando a IA trava, ou em
`maxTurns`. Como o cliente é gerado a cada rodada, o resultado **não é determinístico** — é
ferramenta de exploração, não de regressão. Não use persona como gate de CI.

## Comandos

```bash
npm run dev -- run scenarios/                       # roda a pasta inteira
npm run dev -- run scenarios/x.yaml --json out.json # relatório para CI
npm run dev -- run scenarios/ --adapter cloud-api   # canal real
npm run dev -- run scenarios/x.yaml --continue-on-failure
npm run dev -- validate scenarios/                  # valida YAML sem chamar nada
npm test                                            # unit
```

Por padrão o cenário para no primeiro turno que falha — turno 3 não diz nada se o turno 1
quebrou o fluxo. `--continue-on-failure` roda tudo mesmo assim.

`stdout` é só o relatório; log vai para `stderr`. `--json` é pipeável.

## Limitações conhecidas

- **Não valida as conexões API da jornada.** As asserções enxergam só o que a IA responde no
  WhatsApp. Se a jornada chama uma API externa (CRM, agenda) e a chamada sai errada mas a
  resposta ao cliente fica plausível, o teste passa. Cobrir isso pede um spy nas chamadas
  externas — próximo passo natural.
- **Cloud API precisa de template para abrir conversa.** Fora da janela de 24h a Meta exige
  template aprovado; sem ele o primeiro `sendText` volta com erro 131047.
- **Persona não é determinística** (ver acima).
- **Sink não simula falha da Meta.** Ele sempre responde 200. Testar retry/erro de envio da
  plataforma exigiria modo de injeção de falha.
