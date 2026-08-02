import { GraphSinkServer } from './graph-sink.server';
import { sinkFaultSchema } from '../scenario/sink-fault.schema';
import type { OutboundMessage } from '../shared/whatsapp.types';

describe('GraphSinkServer com injeção de falha', () => {
  let sink: GraphSinkServer;
  let baseUrl: string;
  let captured: OutboundMessage[];

  async function start(faults: unknown[] = []): Promise<void> {
    const port = 4500 + Math.floor(Math.random() * 400);
    sink = new GraphSinkServer({
      host: '127.0.0.1',
      port,
      faults: faults.map((fault) => sinkFaultSchema.parse(fault)),
    });
    captured = [];
    sink.onMessage((message) => captured.push(message));
    await sink.start();
    baseUrl = `http://127.0.0.1:${port}`;
  }

  /** Uma tentativa de entrega, como a plataforma faria contra o graph.facebook.com. */
  async function send(text: string, to = '5511999999999'): Promise<Response> {
    return fetch(`${baseUrl}/v21.0/123456/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    });
  }

  afterEach(async () => {
    await sink?.stop();
  });

  it('sem falhas declaradas, responde 200 e entrega ao runner', async () => {
    await start();

    const response = await send('oi');

    expect(response.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(sink.allDeliveries()[0]).toMatchObject({ index: 1, status: 200, isRetry: false });
  });

  it('devolve o erro da Meta com o código do preset', async () => {
    await start([{ fault: 'rate-limit' }]);

    const response = await send('oi');
    const body = (await response.json()) as { error: { code: number; message: string } };

    expect(response.status).toBe(429);
    expect(body.error.code).toBe(130429);
    expect(body.error.message).toBe('Rate limit hit');
  });

  it('entrega recusada não vira mensagem do turno', async () => {
    await start([{ fault: 'server-error' }]);

    await send('oi');

    // Se contasse, a tentativa e o reenvio virariam duas mensagens da IA e
    // qualquer messageCount quebraria à toa.
    expect(captured).toHaveLength(0);
    expect(sink.allDeliveries()[0]).toMatchObject({ status: 500, faultInjected: expect.any(String) });
  });

  it('reconhece o reenvio do mesmo texto depois da recusa', async () => {
    await start([{ fault: 'rate-limit' }]);

    await send('seu horário está confirmado');
    const retry = await send('seu horário está confirmado');

    expect(retry.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(sink.allDeliveries().map((delivery) => delivery.isRetry)).toEqual([false, true]);
  });

  it('texto diferente depois da falha não é reenvio', async () => {
    await start([{ fault: 'rate-limit' }]);

    await send('primeira');
    await send('segunda');

    expect(sink.allDeliveries().map((delivery) => delivery.isRetry)).toEqual([false, false]);
  });

  it('afterCalls deixa a primeira entrega passar', async () => {
    await start([{ fault: 'server-error', afterCalls: 1, times: 'all' }]);

    expect((await send('um')).status).toBe(200);
    expect((await send('dois')).status).toBe(500);
    expect((await send('tres')).status).toBe(500);
    expect(captured.map((message) => message.text)).toEqual(['um']);
  });

  it('drop derruba a conexão em vez de responder', async () => {
    await start([{ drop: true }]);

    await expect(send('oi')).rejects.toThrow();
    expect(sink.allDeliveries()[0]).toMatchObject({ status: 0, isRetry: false });
  });

  it('setFaults troca as regras e zera o histórico entre cenários', async () => {
    await start([{ fault: 'rate-limit', times: 'all' }]);
    await send('oi');
    expect(sink.deliveryCount).toBe(1);

    sink.setFaults([]);
    expect(sink.deliveryCount).toBe(0);
    expect((await send('oi')).status).toBe(200);
  });

  it('deliveriesSince recorta o turno', async () => {
    await start([{ fault: 'rate-limit', times: 'all' }]);

    await send('turno 1');
    const marker = sink.deliveryCount;
    await send('turno 2');

    expect(sink.deliveriesSince(marker).map((delivery) => delivery.text)).toEqual(['turno 2']);
  });
});
