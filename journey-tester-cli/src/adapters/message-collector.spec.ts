import { MessageCollector } from './message-collector';
import type { OutboundMessage } from '../shared/whatsapp.types';

function message(text: string): OutboundMessage {
  return { kind: 'text', text, options: [], to: '1', receivedAt: Date.now(), raw: {} };
}

const WAIT = { replyTimeoutMs: 30_000, settleMs: 2_500 };

describe('MessageCollector', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('agrupa mensagens seguidas em um único turno', async () => {
    const collector = new MessageCollector();
    const pending = collector.wait(WAIT);

    collector.push(message('Oi!'));
    jest.advanceTimersByTime(1_000);
    collector.push(message('Como posso ajudar?'));
    jest.advanceTimersByTime(WAIT.settleMs);

    const reply = await pending;
    expect(reply.messages.map((entry) => entry.text)).toEqual(['Oi!', 'Como posso ajudar?']);
    expect(reply.timedOut).toBe(false);
  });

  it('não fecha o turno enquanto a IA continua mandando mensagem', async () => {
    const collector = new MessageCollector();
    const pending = collector.wait(WAIT);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    collector.push(message('primeira'));
    jest.advanceTimersByTime(WAIT.settleMs - 1);
    collector.push(message('segunda'));
    jest.advanceTimersByTime(WAIT.settleMs - 1);
    await Promise.resolve();
    expect(settled).toBe(false);

    jest.advanceTimersByTime(1);
    const reply = await pending;
    expect(reply.messages).toHaveLength(2);
  });

  it('marca timeout quando a IA não responde', async () => {
    const collector = new MessageCollector();
    const pending = collector.wait(WAIT);

    jest.advanceTimersByTime(WAIT.replyTimeoutMs);

    const reply = await pending;
    expect(reply.timedOut).toBe(true);
    expect(reply.messages).toHaveLength(0);
  });

  it('não perde mensagem que chega antes da espera começar', async () => {
    const collector = new MessageCollector();
    collector.push(message('resposta rápida'));

    const pending = collector.wait(WAIT);
    jest.advanceTimersByTime(WAIT.settleMs);

    const reply = await pending;
    expect(reply.messages.map((entry) => entry.text)).toEqual(['resposta rápida']);
  });

  it('reset descarta sobra de turno anterior', async () => {
    const collector = new MessageCollector();
    collector.push(message('lixo do turno anterior'));
    collector.reset();

    const pending = collector.wait(WAIT);
    jest.advanceTimersByTime(WAIT.replyTimeoutMs);

    const reply = await pending;
    expect(reply.messages).toHaveLength(0);
    expect(reply.timedOut).toBe(true);
  });
});
