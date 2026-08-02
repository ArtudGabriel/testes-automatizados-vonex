import { assertionSchema, scenarioSchema, stepSchema } from './scenario.schema';

const validScenario = {
  name: 'agendamento',
  contact: { phone: '5511999999999', name: 'Maria' },
  steps: [{ user: 'oi', expect: [{ contains: 'olá' }] }],
};

describe('assertionSchema', () => {
  it('aceita exatamente uma asserção', () => {
    expect(assertionSchema.safeParse({ contains: 'olá' }).success).toBe(true);
  });

  it('recusa duas asserções no mesmo item', () => {
    const result = assertionSchema.safeParse({ contains: 'olá', matches: '^o' });
    expect(result.success).toBe(false);
  });

  it('recusa item vazio', () => {
    expect(assertionSchema.safeParse({}).success).toBe(false);
  });

  it('recusa chave desconhecida em vez de ignorar em silêncio', () => {
    const result = assertionSchema.safeParse({ contain: 'olá' });
    expect(result.success).toBe(false);
  });

  it('aceita judge como string ou objeto', () => {
    expect(assertionSchema.safeParse({ judge: 'confirmou o agendamento' }).success).toBe(true);
    expect(
      assertionSchema.safeParse({
        judge: { criteria: 'ofereceu horários', mustNot: 'inventou preço' },
      }).success,
    ).toBe(true);
  });

  it('exige min ou max em messageCount', () => {
    expect(assertionSchema.safeParse({ messageCount: {} }).success).toBe(false);
    expect(assertionSchema.safeParse({ messageCount: { max: 3 } }).success).toBe(true);
  });
});

describe('stepSchema', () => {
  it('exige user ou tapOption', () => {
    expect(stepSchema.safeParse({ expect: [] }).success).toBe(false);
  });

  it('recusa user e tapOption juntos', () => {
    expect(stepSchema.safeParse({ user: 'oi', tapOption: 'btn_1' }).success).toBe(false);
  });

  it('deixa expect opcional', () => {
    const result = stepSchema.safeParse({ user: 'oi' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.expect).toEqual([]);
  });
});

describe('scenarioSchema', () => {
  it('aplica os defaults de timeout e settle', () => {
    const result = scenarioSchema.safeParse(validScenario);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.replyTimeoutMs).toBe(30_000);
      expect(result.data.settleMs).toBe(2_500);
    }
  });

  it('recusa cenário sem steps e sem persona', () => {
    const { steps, ...withoutSteps } = validScenario;
    void steps;
    expect(scenarioSchema.safeParse(withoutSteps).success).toBe(false);
  });

  it('recusa steps e persona no mesmo cenário', () => {
    const result = scenarioSchema.safeParse({
      ...validScenario,
      persona: { description: 'x', goal: 'y', firstMessage: 'z' },
    });
    expect(result.success).toBe(false);
  });

  it('recusa telefone com formatação', () => {
    const result = scenarioSchema.safeParse({
      ...validScenario,
      contact: { phone: '+55 (11) 99999-9999' },
    });
    expect(result.success).toBe(false);
  });

  it('aceita cenário de persona com maxTurns default', () => {
    const result = scenarioSchema.safeParse({
      name: 'persona',
      projectFile: '../projects/x.yaml',
      persona: { archetype: 'impatient', goal: 'agendar' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.persona?.maxTurns).toBe(8);
  });

  it('recusa persona sem briefing do projeto', () => {
    const result = scenarioSchema.safeParse({
      name: 'persona',
      persona: { archetype: 'ideal', goal: 'agendar' },
    });
    expect(result.success).toBe(false);
  });

  it('recusa project e projectFile juntos', () => {
    const result = scenarioSchema.safeParse({
      name: 'persona',
      project: { name: 'X', description: 'y' },
      projectFile: './x.yaml',
      persona: { archetype: 'ideal', goal: 'agendar' },
    });
    expect(result.success).toBe(false);
  });

  it('não exige briefing em cenário de steps', () => {
    expect(scenarioSchema.safeParse(validScenario).success).toBe(true);
  });
});

describe('personaSchema (via scenarioSchema)', () => {
  const base = { name: 'x', projectFile: './p.yaml' };

  it('exige archetype ou description', () => {
    const result = scenarioSchema.safeParse({ ...base, persona: { goal: 'agendar' } });
    expect(result.success).toBe(false);
  });

  it('recusa arquétipo inexistente e sugere os válidos', () => {
    const result = scenarioSchema.safeParse({
      ...base,
      persona: { archetype: 'cliente-nervoso', goal: 'agendar' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('angry'))).toBe(true);
    }
  });

  it('aceita archetype e description juntos', () => {
    const result = scenarioSchema.safeParse({
      ...base,
      persona: { archetype: 'angry', description: 'já reclamou duas vezes', goal: 'agendar' },
    });
    expect(result.success).toBe(true);
  });

  it('deixa firstMessage opcional', () => {
    const result = scenarioSchema.safeParse({
      ...base,
      persona: { archetype: 'ideal', goal: 'agendar' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.persona?.firstMessage).toBeUndefined();
  });
});

describe('sinkFaults e sinkRetries (via scenarioSchema)', () => {
  const base = {
    name: 'retry da plataforma',
    steps: [{ user: 'oi', expect: [] }],
  };

  it('aceita preset de falha', () => {
    const result = scenarioSchema.safeParse({
      ...base,
      sinkFaults: [{ fault: 'rate-limit', times: 2 }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sinkFaults?.[0]?.afterCalls).toBe(0);
  });

  it('recusa regra sem preset, status ou drop', () => {
    const result = scenarioSchema.safeParse({ ...base, sinkFaults: [{ afterCalls: 1 }] });
    expect(result.success).toBe(false);
  });

  it('recusa preset inexistente', () => {
    const result = scenarioSchema.safeParse({ ...base, sinkFaults: [{ fault: 'meta-caiu' }] });
    expect(result.success).toBe(false);
  });

  it('exige sinkFaults para asseverar sinkRetries', () => {
    const result = scenarioSchema.safeParse({
      name: 'x',
      steps: [{ user: 'oi', expect: [{ sinkRetries: { min: 1 } }] }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('sinkFaults'))).toBe(true);
    }
  });

  it('sinkRetries com sinkFaults declarado passa', () => {
    const result = scenarioSchema.safeParse({
      ...base,
      sinkFaults: [{ fault: 'server-error' }],
      steps: [{ user: 'oi', expect: [{ sinkRetries: { min: 1, max: 3 } }] }],
    });
    expect(result.success).toBe(true);
  });

  it('sinkRetries precisa de min ou max', () => {
    const result = scenarioSchema.safeParse({
      ...base,
      sinkFaults: [{ fault: 'server-error' }],
      steps: [{ user: 'oi', expect: [{ sinkRetries: {} }] }],
    });
    expect(result.success).toBe(false);
  });

  it('barra sinkFaults em adapter sem sink', () => {
    const result = scenarioSchema.safeParse({
      ...base,
      adapter: 'evolution',
      sinkFaults: [{ fault: 'rate-limit' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('adapter http'))).toBe(true);
    }
  });

  it('sinkRetries continua sendo uma asserção por item', () => {
    const result = scenarioSchema.safeParse({
      ...base,
      sinkFaults: [{ fault: 'rate-limit' }],
      steps: [{ user: 'oi', expect: [{ sinkRetries: { min: 1 }, contains: 'ok' }] }],
    });
    expect(result.success).toBe(false);
  });
});
