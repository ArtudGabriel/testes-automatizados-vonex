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
      persona: { description: 'cliente apressado', goal: 'agendar', firstMessage: 'oi' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.persona?.maxTurns).toBe(8);
  });
});
