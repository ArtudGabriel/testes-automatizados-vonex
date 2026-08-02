import { checkSinkFaults } from './doctor';
import type { LoadedScenario } from '../scenario/scenario.loader';
import { scenarioSchema } from '../scenario/scenario.schema';

function scenario(raw: Record<string, unknown>): LoadedScenario {
  return {
    filePath: '/x/cenario.yaml',
    spec: scenarioSchema.parse({
      name: 'x',
      steps: [{ user: 'oi', expect: [] }],
      ...raw,
    }),
  };
}

describe('checkSinkFaults', () => {
  it('cala quando nenhum cenário injeta falha', () => {
    expect(checkSinkFaults([scenario({})], { DEFAULT_ADAPTER: 'evolution' })).toBeUndefined();
  });

  it('aprova quando o cenário declara adapter http', () => {
    const check = checkSinkFaults(
      [scenario({ adapter: 'http', sinkFaults: [{ fault: 'rate-limit' }] })],
      { DEFAULT_ADAPTER: 'evolution' },
    );
    expect(check?.status).toBe('ok');
  });

  /**
   * O default do projeto é `evolution`. Um cenário sem `adapter` herdaria um
   * transporte sem sink e passaria verde sem ter injetado nada.
   */
  it('reprova quando o cenário herdaria um adapter sem sink', () => {
    const check = checkSinkFaults([scenario({ sinkFaults: [{ fault: 'rate-limit' }] })], {
      DEFAULT_ADAPTER: 'evolution',
    });
    expect(check?.status).toBe('fail');
    expect(check?.hint).toContain('--adapter http');
  });

  it('aprova quando o próprio default é http', () => {
    const check = checkSinkFaults([scenario({ sinkFaults: [{ fault: 'rate-limit' }] })], {
      DEFAULT_ADAPTER: 'http',
    });
    expect(check?.status).toBe('ok');
  });
});
