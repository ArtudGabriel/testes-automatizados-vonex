# journey-tester-cli

Roda jornadas de IA do WhatsApp contra cenários declarativos, sem ninguém digitando no celular.

**Este projeto roda em Evolution API** — a vonex.ai não pode ser reconfigurada, então o
transporte é um chip de teste automatizado conversando com o número onde a jornada está
publicada. Setup completo:

```bash
npm install
cp .env.example .env

docker compose up -d                 # sobe a Evolution API em :8080
# abra http://localhost:8080/manager, crie a instância e leia o QR com o CHIP DE TESTE

npm run dev -- doctor scenarios/     # confirma que o chip está conectado
npm run dev -- run scenarios/agendamento-consulta.yaml
```

No `.env`, três linhas bastam para começar:

```bash
WA_PROVIDER_TOKEN=<a mesma AUTHENTICATION_API_KEY do compose>
WA_PROVIDER_INSTANCE=teste
BOT_PHONE_NUMBER=<número oficial onde a jornada está publicada>
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

### Os adapters

| | `http` | `z-api` · `evolution` · `uazapi` | `cloud-api` |
|---|---|---|---|
| Como injeta | payload de webhook direto na vonex.ai | chip de teste via API não-oficial | número de teste na Cloud API oficial |
| Como captura | graph sink local | polling do chat (ou webhook) | webhook do número de teste |
| **Exige mexer na plataforma** | **sim** (base URL da Cloud API) | **não** | **não** |
| Túnel público | não | não (no modo `poll`) | sim |
| Template p/ abrir conversa | n/a | não | **sim** (erro 131047 sem ele) |
| Custo | zero | mensalidade do provedor | por conversa |
| Roda em CI | sim | sim | não |
| Risco | nenhum | **ban do chip** (API fora do ToS) | nenhum |
| Quando usar | quando dá para configurar a plataforma | quando não dá | smoke test do canal antes do go-live |

Trocar de adapter não muda o cenário: `--adapter evolution` roda o mesmo YAML por outro caminho.

**Escolhendo:** se você consegue apontar a base URL da Cloud API da vonex.ai para o sink, use
`http` — é grátis, determinístico e sem risco. Se não consegue mexer na plataforma, um dos
adapters não-oficiais é o caminho: a jornada receptiva recebe exatamente o que receberia de um
cliente real, sem template e sem janela de 24h. O preço é usar uma API fora dos termos do
WhatsApp, com risco de banimento do número conectado — **use um chip dedicado, nunca o número
de trabalho**.

### Setup dos adapters não-oficiais

Os três provedores fazem a mesma coisa com contratos HTTP diferentes, então o adapter é um só
e o que muda é o **perfil**. A configuração é a mesma para todos:

```bash
WA_PROVIDER_BASE_URL=<https://api.z-api.io | http://localhost:8080 | https://x.uazapi.com>
WA_PROVIDER_INSTANCE=<instância no painel do provedor>
WA_PROVIDER_TOKEN=<z-api: token da instância · evolution: apikey · uazapi: token>
BOT_PHONE_NUMBER=<número oficial onde a jornada está publicada>
WA_PROVIDER_CAPTURE=poll   # dispensa túnel; `webhook` dá latência menor
```

E no cenário (ou via `--adapter`):

```yaml
adapter: evolution      # ou z-api, ou uazapi
```

No painel do provedor, conecte o chip de teste lendo o QR. Só isso — nada muda na vonex.ai.

**Perfis embutidos** (o que cada provedor espera):

| | Auth | Envio | Leitura |
|---|---|---|---|
| `z-api` | instância+token no caminho, `client-token` opcional | `POST /send-text` | `GET /chat-messages/{phone}` |
| `evolution` | header `apikey` | `POST /message/sendText/{instância}` | `POST /chat/findMessages/{instância}` |
| `uazapi` | header `token` | `POST /send/text` | `POST /message/find` |

> **Se o contrato do seu provedor divergir**, ajuste por env em vez de mexer em código:
> `WA_PROVIDER_SEND_PATH`, `WA_PROVIDER_FETCH_PATH`, `WA_PROVIDER_AUTH_HEADER`. O normalizador
> de mensagens (`src/shared/unofficial-message.ts`) entende o formato plano da Z-API e o
> envelope Baileys do Evolution/Uazapi, com as variações conhecidas de nome de campo.

**Latência no modo `poll`:** o valor medido inclui até um intervalo de polling (1,5s por
padrão). Se o cenário usa `maxLatencyMs` com folga curta, reduza `WA_PROVIDER_POLL_MS` ou use
`WA_PROVIDER_CAPTURE=webhook` — no `http` a medição é exata, aqui é uma cota superior.

## Antes da primeira rodada: `doctor`

A maioria das falhas de estreia é configuração, e todas se manifestam do mesmo jeito inútil —
"a IA não respondeu". O `doctor` checa antes:

```bash
npm run dev -- doctor scenarios/
```

```text
✓ adapter evolution: captura por polling a cada 1500ms (sem túnel) em http://localhost:8080
✗ sessão do Evolution API: chip desconectado
    → releia o QR no painel do provedor — a sessão caiu
✗ ANTHROPIC_API_KEY: 5 cenário(s) usam judge ou persona, mas a chave não está definida
    → defina ANTHROPIC_API_KEY no .env, ou rode só cenários determinísticos
```

A checagem de sessão é a que mais paga: sessão Baileys cai sozinha (logout no celular,
container reiniciado, troca de aparelho) e o sintoma seria um timeout genérico.

Exit code 1 se algo bloqueia. E se o cenário rodar mas o sink não receber nada em turno
nenhum, o runner avisa explicitamente que a base URL provavelmente não está apontada — em vez
de deixar você achando que a jornada travou.

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
| `apiCall: { to, times, bodyContains }` | a jornada chamou a API externa como deveria |
| `noApiCall: "DELETE /x/*"` | a jornada **não** chamou este endpoint |

O texto avaliado inclui os títulos dos botões/lista (`[opções: 09:00 | 14:00]`), então dá para
asseverar sobre o que a IA ofereceu, não só sobre o que ela escreveu.

**Determinístico primeiro.** É grátis, instantâneo e não tem falso negativo. `judge` só onde a
resposta é livre — cada asserção dessas é uma chamada de LLM. Rubrica específica ("confirmou o
agendamento repetindo data e horário") produz muito menos ruído que rubrica vaga ("respondeu bem").

### Spy das conexões API da jornada

Asserção de texto só enxerga o que a IA escreve. Se a jornada chama o CRM errado — ou não
chama nada — e responde algo plausível, o teste passa. O spy fecha esse buraco usando o mesmo
truque do graph sink: finge ser a API externa.

Aponte a base URL da API, no ambiente de teste da vonex.ai, para `http://127.0.0.1:4030`
(`API_SPY_HOST`/`API_SPY_PORT`), e declare no cenário:

```yaml
apiSpy:
  stubs:
    - match: GET /agenda/horarios          # `MÉTODO /caminho`, com * de curinga
      respond:
        body:
          horarios:
            - { id: "h_0900", inicio: "2026-06-12T09:00" }

    - match: POST /agenda/consultas
      respond:
        status: 201
        body: { id: 987, status: "confirmada" }
        delayMs: 200                       # opcional: simula API lenta

steps:
  - user: "o das 9 tá ótimo"
    expect:
      - contains: "confirmada"
      - apiCall:
          to: POST /agenda/consultas
          times: 1                          # número exato, ou { min, max }
          bodyContains:                     # subconjunto: campo extra não quebra
            paciente_cpf: "123.456.789-00"
            horario_id: "h_0900"
      - noApiCall: DELETE /agenda/*
```

Isso pega três bugs que passavam batido:

| Bug | Como aparece |
|---|---|
| A IA diz "agendado!" mas não agendou | `apiCall` falha com *nenhuma chamada à API* enquanto `contains` passa |
| Chamou com payload errado | `apiCall` falha com *payload não bate*, mostrando o que foi enviado |
| Chamou duas vezes | `times: 1` falha com *2 chamada(s)* |

Os `stubs` dão **determinismo** de brinde: a jornada recebe sempre a mesma resposta, então o
cenário para de depender do estado do banco de teste. Chamada sem stub recebe `200 {}` e um
aviso no log — fica registrada, nunca silenciosa.

As chamadas aparecem no relatório (`⇢ api POST /agenda/consultas {...}`), o que costuma ser a
informação que explica por que a IA respondeu aquilo. `authorization`, `x-api-key` e `cookie`
são redigidos antes de qualquer coisa ir para o relatório ou para o JSON.

Escopo: `apiCall`/`noApiCall` num `step` olham as chamadas **daquele turno**; no `expect` da
persona, olham a conversa inteira.

### Briefing do projeto

Todo cenário com persona precisa saber **o que a jornada faz**. Sem isso o cliente simulado
improvisa: não sabe o que pedir, inventa um CPF quando a IA pede identificação, e insiste em
algo que está fora do escopo.

O briefing costuma ser o mesmo para todos os cenários de uma implantação, então mora num
arquivo à parte (`projects/`) e os cenários apontam para ele:

```yaml
# scenarios/qualquer-cenario.yaml
projectFile: ../projects/clinica-odonto.yaml
```

```yaml
# projects/clinica-odonto.yaml
name: Clínica OdontoVida
segment: clínica odontológica de bairro
description: >
  Atendimento ao paciente pelo WhatsApp: agendar, remarcar e cancelar consultas...

capabilities:                    # o que a IA deve resolver
  - agendar consulta escolhendo especialidade, data e horário
  - informar quais documentos levar

outOfScope:                      # o que ela NÃO faz
  - orientação clínica ou diagnóstico
  - negociar preço ou dar desconto

knownData:                       # dados que o cliente simulado tem em mãos
  nome completo: Maria Aparecida de Souza
  CPF: "123.456.789-00"
  consulta já marcada: quinta-feira, 12/06, às 14:30

glossary:
  - term: profilaxia
    meaning: limpeza dental de rotina

escalation: Transferir para humano quando o paciente pedir, ou se houver dor forte
```

`outOfScope` faz dobradinha com o judge: recusar educadamente algo fora do escopo passa a ser
avaliado como **acerto**, não como falha. `knownData` deve conter dados fictícios — eles vão
para a plataforma e para o modelo.

Um cenário pode trazer `project:` inline em vez de `projectFile`, mas não os dois.

### Modo persona

Roteiro fixo só testa o caminho feliz. A persona põe um LLM no papel do cliente, vestindo um
**arquétipo** — o tipo de cliente que vai fazer o teste:

```yaml
projectFile: ../projects/clinica-odonto.yaml

persona:
  archetype: angry              # journey-tester personas lista todos
  goal: >
    Resolver que perdeu a consulta porque ninguém avisou do atraso, e conseguir
    um novo horário nesta semana.
  maxTurns: 8
  expect:                       # avaliado sobre a conversa inteira
    - judge:
        criteria: a IA manteve tom cordial do início ao fim
        mustNot: prometeu desconto por conta própria
```

**Arquétipos disponíveis** (`journey-tester personas -v` mostra comportamento e táticas):

| id | Cliente | O que estressa |
|---|---|---|
| `ideal` | Cliente ideal | caminho feliz, colabora e segue o fluxo |
| `confused` | Cliente confuso | clareza da IA e recuperação de mal-entendido |
| `angry` | Cliente bravo | tom, contenção e resistir a pedido de exceção |
| `wants-human` | Quer humano | caminho de escalonamento |
| `impatient` | Apressado | fluxo aguenta resposta curta e fora de ordem |
| `indecisive` | Indeciso | refazer escolha sem perder o estado |
| `distrustful` | Desconfiado | transparência sobre por que pede cada dado |
| `boundary-tester` | Testa limites | recusa graciosa e vazamento de instrução |

Cada arquétipo carrega comportamento (como escreve), **táticas** (o que faz de propósito para
estressar a jornada) e o que conta como sucesso para aquele tipo — um `wants-human` "vence"
sendo transferido, não sendo atendido pelo bot.

Combine com `description` para somar traços ao arquétipo, ou use só `description` para um
cliente que não cabe em nenhum:

```yaml
persona:
  archetype: distrustful
  description: já teve o cartão clonado e ficou traumatizado com pedido de dado
  goal: ...
```

`firstMessage` é opcional: sem ele a própria persona abre a conversa, e um cliente bravo abre
diferente de um cliente ideal. Fixe só quando o gatilho exato importar.

A conversa para quando a persona considera o objetivo atingido, quando a IA trava, ou em
`maxTurns`. Como o cliente é gerado a cada rodada, o resultado **não é determinístico** — é
ferramenta de exploração, não de regressão. Não use persona como gate de CI.

## Comandos

```bash
npm run dev -- run scenarios/                       # roda a pasta inteira
npm run dev -- doctor scenarios/                    # pré-voo da configuração
npm run dev -- run scenarios/x.yaml --json out.json # relatório para histórico
npm run dev -- run scenarios/ --junit results.xml   # relatório que o CI renderiza
npm run dev -- run scenarios/ --adapter cloud-api   # canal real
npm run dev -- run scenarios/x.yaml --continue-on-failure
npm run dev -- validate scenarios/                  # valida YAML sem chamar nada
npm run dev -- personas                             # lista os tipos de cliente
npm run dev -- personas -v                          # com comportamento e táticas
npm test                                            # unit
```

Por padrão o cenário para no primeiro turno que falha — turno 3 não diz nada se o turno 1
quebrou o fluxo. `--continue-on-failure` roda tudo mesmo assim.

`stdout` é só o relatório; log vai para `stderr`. `--json` é pipeável.

## Limitações conhecidas

- **Cloud API precisa de template para abrir conversa.** Fora da janela de 24h a Meta exige
  template aprovado; sem ele o primeiro `sendText` volta com erro 131047.
- **Persona não é determinística** (ver acima).
- **Sink não simula falha da Meta.** Ele sempre responde 200. Testar retry/erro de envio da
  plataforma exigiria modo de injeção de falha.
- **Um cenário por vez.** Sink e spy usam porta fixa, então rodar cenários em paralelo exigiria
  alocação de porta por cenário.
- **O spy cobre HTTP.** Integração por fila, webhook de saída ou banco direto não é
  interceptada.
