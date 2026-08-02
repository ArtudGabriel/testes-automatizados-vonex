import { planConcurrency } from './concurrency.plan';
import type { LoadedScenario } from '../scenario/scenario.loader';
import { scenarioSchema } from '../scenario/scenario.schema';

function scenario(raw: Record<string, unknown> = {}): LoadedScenario {
  return {
    filePath: '/x/cenario.yaml',
    spec: scenarioSchema.parse({
      name: 'cenário',
      steps: [{ user: 'oi', expect: [] }],
      ...raw,
    }),
  };
}

/** Cenários http com contatos distintos — o caso que paraleliza. */
function paralelizaveis(quantidade: number): LoadedScenario[] {
  return Array.from({ length: quantidade }, (_, index) =>
    scenario({
      name: `cenário ${index}`,
      adapter: 'http',
      contact: { phone: `551199999${String(1000 + index)}`, name: 'Cliente' },
    }),
  );
}

describe('planConcurrency', () => {
  const defaultAdapter = 'http' as const;

  it('paraleliza cenários http com contatos distintos', () => {
    const plan = planConcurrency({
      scenarios: paralelizaveis(4),
      requested: 3,
      defaultAdapter,
    });
    expect(plan).toEqual({ concurrency: 3 });
  });

  it('não passa da quantidade de cenários', () => {
    const plan = planConcurrency({
      scenarios: paralelizaveis(2),
      requested: 8,
      defaultAdapter,
    });
    expect(plan.concurrency).toBe(2);
  });

  it('pedido de 1 é respeitado sem explicação', () => {
    expect(planConcurrency({ scenarios: paralelizaveis(4), requested: 1, defaultAdapter })).toEqual({
      concurrency: 1,
    });
  });

  it('cai para 1 no adapter de chip, que é um só', () => {
    const plan = planConcurrency({
      scenarios: [scenario({ adapter: 'evolution' }), ...paralelizaveis(1)],
      requested: 4,
      defaultAdapter,
    });
    expect(plan.concurrency).toBe(1);
    expect(plan.reason).toContain('evolution');
  });

  it('cai para 1 quando o default herdado não tem sink', () => {
    const plan = planConcurrency({
      scenarios: paralelizaveis(2).map((entry) => ({
        ...entry,
        spec: { ...entry.spec, adapter: undefined },
      })),
      requested: 4,
      defaultAdapter: 'evolution',
    });
    expect(plan.concurrency).toBe(1);
  });

  it('o --adapter sobrescreve e pode liberar o paralelismo', () => {
    const plan = planConcurrency({
      scenarios: paralelizaveis(2).map((entry) => ({
        ...entry,
        spec: { ...entry.spec, adapter: undefined },
      })),
      requested: 2,
      defaultAdapter: 'evolution',
      override: 'http',
    });
    expect(plan.concurrency).toBe(2);
  });

  it('cai para 1 com apiSpy: a chamada não diz de que cenário veio', () => {
    const plan = planConcurrency({
      scenarios: [
        ...paralelizaveis(1),
        scenario({
          name: 'com spy',
          adapter: 'http',
          contact: { phone: '5511977776666', name: 'Outro' },
          apiSpy: { stubs: [] },
        }),
      ],
      requested: 4,
      defaultAdapter,
    });
    expect(plan.concurrency).toBe(1);
    expect(plan.reason).toContain('apiSpy');
  });

  it('cai para 1 com injeção de falha: o sink é compartilhado', () => {
    const plan = planConcurrency({
      scenarios: [
        ...paralelizaveis(1),
        scenario({
          name: 'retry',
          adapter: 'http',
          contact: { phone: '5511977776666', name: 'Outro' },
          sinkFaults: [{ fault: 'rate-limit' }],
        }),
      ],
      requested: 4,
      defaultAdapter,
    });
    expect(plan.concurrency).toBe(1);
    expect(plan.reason).toContain('falha');
  });

  it('cai para 1 quando dois cenários usam o mesmo número', () => {
    const plan = planConcurrency({
      scenarios: [
        scenario({ adapter: 'http', contact: { phone: '5511999991000', name: 'A' } }),
        scenario({ adapter: 'http', contact: { phone: '5511999991000', name: 'B' } }),
      ],
      requested: 2,
      defaultAdapter,
    });
    expect(plan.concurrency).toBe(1);
    expect(plan.reason).toContain('roteia pelo destinatário');
  });

  it('trata o nono dígito como o mesmo número', () => {
    const plan = planConcurrency({
      scenarios: [
        scenario({ adapter: 'http', contact: { phone: '5511999991000', name: 'A' } }),
        scenario({ adapter: 'http', contact: { phone: '551199991000', name: 'B' } }),
      ],
      requested: 2,
      defaultAdapter,
    });
    expect(plan.concurrency).toBe(1);
  });
});
