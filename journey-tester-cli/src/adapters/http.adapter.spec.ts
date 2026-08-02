import { HttpChannelAdapter } from './http.adapter';
import type { AppConfig } from '../config/env.config';

/**
 * Dois cenários simultâneos dividem o mesmo sink — a porta está configurada na
 * vonex.ai e não pode variar por cenário. O roteamento é pelo destinatário.
 */
describe('HttpChannelAdapter com sink compartilhado', () => {
  const port = 4620;
  const config = {
    PLATFORM_WEBHOOK_URL: 'http://127.0.0.1:1/webhook',
    GRAPH_SINK_HOST: '127.0.0.1',
    GRAPH_SINK_PORT: port,
  } as AppConfig;

  let maria: HttpChannelAdapter;
  let roberto: HttpChannelAdapter;

  async function platformSends(to: string, body: string): Promise<void> {
    await fetch(`http://127.0.0.1:${port}/v21.0/123/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
    });
  }

  // Os dois cenários ficam abertos durante o arquivo inteiro: é justamente o
  // estado que se quer testar, e evita derrubar a porta entre um teste e outro.
  beforeAll(async () => {
    maria = new HttpChannelAdapter(config);
    roberto = new HttpChannelAdapter(config);
    await maria.open({ contact: { phone: '5511999998888', name: 'Maria' }, scenarioName: 'a' });
    await roberto.open({ contact: { phone: '5511977776666', name: 'Roberto' }, scenarioName: 'b' });
  });

  afterAll(async () => {
    await maria.close();
    await roberto.close();
  });

  it('cada cenário recebe só as mensagens do seu contato', async () => {
    const aguardaMaria = maria.waitForReply({ replyTimeoutMs: 2_000, settleMs: 150 });
    const aguardaRoberto = roberto.waitForReply({ replyTimeoutMs: 2_000, settleMs: 150 });

    await platformSends('5511999998888', 'oi Maria');
    await platformSends('5511977776666', 'oi Roberto');

    expect((await aguardaMaria).messages.map((message) => message.text)).toEqual(['oi Maria']);
    expect((await aguardaRoberto).messages.map((message) => message.text)).toEqual(['oi Roberto']);
  });

  it('número formatado pela plataforma continua roteando certo', async () => {
    const aguardaMaria = maria.waitForReply({ replyTimeoutMs: 2_000, settleMs: 150 });

    await platformSends('+55 (11) 99999-8888', 'formatado');

    expect((await aguardaMaria).messages.map((message) => message.text)).toEqual(['formatado']);
  });

  it('mensagem sem destinatário não some — cai em quem estiver ouvindo', async () => {
    const aguardaMaria = maria.waitForReply({ replyTimeoutMs: 2_000, settleMs: 150 });

    await platformSends('', 'sem destinatário');

    expect((await aguardaMaria).messages).toHaveLength(1);
  });
});
