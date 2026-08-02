import { evaluateSinkRetries } from './sink-retry.evaluator';
import type { SinkDelivery } from '../capture/graph-sink.server';

function delivery(overrides: Partial<SinkDelivery> = {}): SinkDelivery {
  return {
    index: 1,
    to: '5511999999999',
    text: 'confirmado',
    receivedAt: 1000,
    status: 200,
    isRetry: false,
    ...overrides,
  };
}

describe('evaluateSinkRetries', () => {
  it('passa quando a plataforma reenviou o mínimo pedido', () => {
    const result = evaluateSinkRetries({ min: 1 }, [
      delivery({ index: 1, status: 429, faultInjected: 'rate-limit (429/130429)' }),
      delivery({ index: 2, isRetry: true }),
    ]);

    expect(result.kind).toBe('sinkRetries');
    expect(result.passed).toBe(true);
    expect(result.actual).toContain('1 reenvio(s)');
  });

  it('falha quando a plataforma engoliu a falha sem reenviar', () => {
    const result = evaluateSinkRetries({ min: 1 }, [
      delivery({ status: 500, faultInjected: 'server-error (500/131000)' }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.actual).toContain('0 reenvio(s)');
    expect(result.actual).toContain('1 falha(s) injetada(s)');
  });

  it('max pega retry sem teto — o que duplicaria a mensagem do cliente', () => {
    const deliveries = [
      delivery({ index: 1, status: 429, faultInjected: 'rate-limit (429/130429)' }),
      ...[2, 3, 4].map((index) => delivery({ index, isRetry: true })),
    ];

    expect(evaluateSinkRetries({ max: 2 }, deliveries).passed).toBe(false);
    expect(evaluateSinkRetries({ max: 3 }, deliveries).passed).toBe(true);
  });

  it('sem entrega nenhuma, conta zero em vez de quebrar', () => {
    const result = evaluateSinkRetries({ max: 0 }, []);
    expect(result.passed).toBe(true);
    expect(result.actual).toContain('0 reenvio(s) em 0 tentativa(s)');
  });
});
