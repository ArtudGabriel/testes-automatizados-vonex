import { createServer, type Server } from 'node:http';
import { CloudApiChannelAdapter } from './cloud-api.adapter';
import type { AppConfig } from '../config/env.config';
import { OUTSIDE_WINDOW_CODE } from '../shared/cloud-api.error';

interface SentPayload {
  type?: string;
  template?: { name: string; language: { code: string }; components?: unknown[] };
  text?: { body: string };
}

/** Cloud API falsa: guarda o que foi enviado e devolve o erro que o teste pedir. */
function fakeCloudApi(): {
  server: Server;
  sent: SentPayload[];
  listen: () => Promise<string>;
  failNextWith: (status: number, code: number) => void;
} {
  const sent: SentPayload[] = [];
  let failure: { status: number; code: number } | undefined;

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const payload = JSON.parse(body) as SentPayload;
      sent.push(payload);

      // O erro vale só para texto livre: é o template que abre a janela.
      if (failure && payload.type === 'text') {
        res.writeHead(failure.status, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: 'Message failed to send',
              code: failure.code,
              error_data: { details: 'more than 24 hours have passed' },
            },
          }),
        );
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messages: [{ id: 'wamid.FAKE' }] }));
    });
  });

  return {
    server,
    sent,
    failNextWith: (status, code) => {
      failure = { status, code };
    },
    listen: () =>
      new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          const port = typeof address === 'object' && address ? address.port : 0;
          resolve(`http://127.0.0.1:${port}`);
        });
      }),
  };
}

describe('CloudApiChannelAdapter — abertura da janela de 24h', () => {
  const cloud = fakeCloudApi();
  let baseUrl: string;
  let adapter: CloudApiChannelAdapter;
  const webhookPort = 4700 + Math.floor(Math.random() * 200);

  function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
    return {
      CLOUD_API_BASE_URL: baseUrl,
      CLOUD_API_TOKEN: 'TOK',
      TESTER_PHONE_NUMBER_ID: '111',
      BOT_PHONE_NUMBER: '5511888887777',
      CLOUD_API_OPEN_TEMPLATE_LANG: 'pt_BR',
      CLOUD_API_OPEN_TIMEOUT_MS: 800,
      INBOUND_WEBHOOK_PORT: webhookPort,
      INBOUND_WEBHOOK_HOST: '127.0.0.1',
      INBOUND_VERIFY_TOKEN: 'journey-tester',
      ...overrides,
    } as AppConfig;
  }

  /** Simula o webhook da Meta entregando a resposta do bot. */
  async function deliverInbound(text: string): Promise<void> {
    await fetch(`http://127.0.0.1:${webhookPort}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    { from: '5511888887777', type: 'text', text: { body: text } },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });
  }

  beforeAll(async () => {
    baseUrl = await cloud.listen();
  });

  afterEach(async () => {
    await adapter?.close();
    cloud.sent.length = 0;
  });

  afterAll(() => {
    cloud.server.close();
  });

  it('manda o template antes da primeira mensagem e espera o bot responder', async () => {
    adapter = new CloudApiChannelAdapter(
      buildConfig({ CLOUD_API_OPEN_TEMPLATE: 'abertura_teste' }),
    );
    await adapter.open({ contact: { phone: '5511999999999', name: 'Maria' }, scenarioName: 'x' });

    const sending = adapter.sendText('oi, quero marcar uma consulta');
    // A janela só abre quando o bot responde ao template.
    await new Promise((resolve) => setTimeout(resolve, 150));
    await deliverInbound('Olá! Como posso ajudar?');
    await sending;

    expect(cloud.sent.map((payload) => payload.type)).toEqual(['template', 'text']);
    expect(cloud.sent[0]?.template).toMatchObject({
      name: 'abertura_teste',
      language: { code: 'pt_BR' },
    });
    expect(cloud.sent[1]?.text?.body).toBe('oi, quero marcar uma consulta');
  }, 15_000);

  it('a resposta ao template é handshake e não entra no turno seguinte', async () => {
    adapter = new CloudApiChannelAdapter(
      buildConfig({ CLOUD_API_OPEN_TEMPLATE: 'abertura_teste' }),
    );
    await adapter.open({ contact: { phone: '5511999999999', name: 'Maria' }, scenarioName: 'x' });

    const sending = adapter.sendText('oi');
    await new Promise((resolve) => setTimeout(resolve, 150));
    await deliverInbound('resposta ao template');
    await sending;

    const waiting = adapter.waitForReply({ replyTimeoutMs: 1_500, settleMs: 200 });
    await deliverInbound('resposta do turno 1');
    const reply = await waiting;

    expect(reply.messages.map((message) => message.text)).toEqual(['resposta do turno 1']);
  }, 15_000);

  it('só manda components quando o template tem variável', async () => {
    adapter = new CloudApiChannelAdapter(
      buildConfig({
        CLOUD_API_OPEN_TEMPLATE: 'abertura_teste',
        CLOUD_API_OPEN_TEMPLATE_PARAMS: 'Maria | Clínica OdontoVida',
      }),
    );
    await adapter.open({ contact: { phone: '5511999999999', name: 'Maria' }, scenarioName: 'x' });

    const sending = adapter.sendText('oi');
    await new Promise((resolve) => setTimeout(resolve, 150));
    await deliverInbound('Olá!');
    await sending;

    expect(cloud.sent[0]?.template?.components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Maria' },
          { type: 'text', text: 'Clínica OdontoVida' },
        ],
      },
    ]);
  }, 15_000);

  it('sem template configurado, o 131047 vira erro com a saída', async () => {
    cloud.failNextWith(400, OUTSIDE_WINDOW_CODE);
    adapter = new CloudApiChannelAdapter(buildConfig());
    await adapter.open({ contact: { phone: '5511999999999', name: 'Maria' }, scenarioName: 'x' });

    await expect(adapter.sendText('oi')).rejects.toThrow(/CLOUD_API_OPEN_TEMPLATE/);
    expect(cloud.sent.map((payload) => payload.type)).toEqual(['text']);
  });
});
