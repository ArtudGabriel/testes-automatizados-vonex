import { SinkFaultInjector, coversAttempt, toDecision } from './sink-fault.injector';
import { sinkFaultSchema, type SinkFaultSpec } from '../scenario/sink-fault.schema';

function rule(raw: unknown): SinkFaultSpec {
  return sinkFaultSchema.parse(raw);
}

describe('coversAttempt', () => {
  it('sem afterCalls, pega a primeira tentativa', () => {
    const spec = rule({ fault: 'rate-limit' });
    expect(coversAttempt(spec, 0)).toBe(true);
    expect(coversAttempt(spec, 1)).toBe(false);
  });

  it('afterCalls deixa passar as primeiras tentativas', () => {
    const spec = rule({ fault: 'rate-limit', afterCalls: 2, times: 2 });
    expect(coversAttempt(spec, 0)).toBe(false);
    expect(coversAttempt(spec, 1)).toBe(false);
    expect(coversAttempt(spec, 2)).toBe(true);
    expect(coversAttempt(spec, 3)).toBe(true);
    expect(coversAttempt(spec, 4)).toBe(false);
  });

  it('times: all não tem fim', () => {
    const spec = rule({ fault: 'server-error', times: 'all' });
    expect(coversAttempt(spec, 0)).toBe(true);
    expect(coversAttempt(spec, 99)).toBe(true);
  });
});

describe('toDecision', () => {
  it('usa status e código reais do preset', () => {
    const decision = toDecision(rule({ fault: 'outside-window' }));
    expect(decision.status).toBe(400);
    expect(decision.body).toMatchObject({ error: { code: 131047 } });
    expect(decision.label).toContain('outside-window');
  });

  it('deixa o cenário sobrescrever o preset', () => {
    const decision = toDecision(rule({ fault: 'rate-limit', status: 503, message: 'tenta depois' }));
    expect(decision.status).toBe(503);
    expect(decision.body).toMatchObject({ error: { message: 'tenta depois', code: 130429 } });
  });

  it('aceita falha sem preset, só com status', () => {
    const decision = toDecision(rule({ status: 418 }));
    expect(decision.status).toBe(418);
    expect(decision.label).toContain('custom');
  });

  it('mantém o envelope de erro da Cloud API, para a plataforma não notar', () => {
    const decision = toDecision(rule({ fault: 'server-error' })) as {
      body: { error: Record<string, unknown> };
    };
    expect(Object.keys(decision.body.error)).toEqual(
      expect.arrayContaining(['message', 'type', 'code', 'error_data', 'fbtrace_id']),
    );
  });

  it('drop não tem status HTTP para devolver', () => {
    const decision = toDecision(rule({ drop: true }));
    expect(decision.drop).toBe(true);
    expect(decision.label).toContain('conexão derrubada');
  });
});

describe('SinkFaultInjector', () => {
  it('sem regras, nunca falha', () => {
    const injector = new SinkFaultInjector();
    expect(injector.hasRules).toBe(false);
    expect(injector.next()).toBeUndefined();
    expect(injector.next()).toBeUndefined();
  });

  it('falha as tentativas da janela e libera as seguintes', () => {
    const injector = new SinkFaultInjector([rule({ fault: 'rate-limit', times: 2 })]);
    expect(injector.next()?.status).toBe(429);
    expect(injector.next()?.status).toBe(429);
    expect(injector.next()).toBeUndefined();
  });

  it('conta tentativas, reenvio incluído — não mensagens distintas', () => {
    const injector = new SinkFaultInjector([rule({ fault: 'server-error', afterCalls: 1 })]);
    expect(injector.next()).toBeUndefined(); // 1ª entrega passa
    expect(injector.next()?.status).toBe(500); // reenvio ou mensagem nova: é a 2ª tentativa
    expect(injector.next()).toBeUndefined();
  });

  it('primeira regra que casa vence', () => {
    const injector = new SinkFaultInjector([
      rule({ fault: 'rate-limit' }),
      rule({ fault: 'server-error', times: 'all' }),
    ]);
    expect(injector.next()?.status).toBe(429);
    expect(injector.next()?.status).toBe(500);
  });

  it('reset volta a contagem para o começo', () => {
    const injector = new SinkFaultInjector([rule({ fault: 'rate-limit' })]);
    expect(injector.next()?.status).toBe(429);
    expect(injector.next()).toBeUndefined();
    injector.reset();
    expect(injector.next()?.status).toBe(429);
  });
});
