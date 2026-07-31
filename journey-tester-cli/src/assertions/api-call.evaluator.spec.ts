import { evaluateApiCall, evaluateNoApiCall, isSubset } from './api-call.evaluator';
import type { RecordedApiCall } from '../capture/api-spy.server';

function call(
  method: string,
  path: string,
  body?: unknown,
  query: Record<string, string> = {},
): RecordedApiCall {
  return { method, path, query, headers: {}, body, receivedAt: 0 };
}

const agendar = call('POST', '/agenda/consultas', {
  paciente_cpf: '123.456.789-00',
  horario: '2026-06-12T14:30',
});

describe('isSubset', () => {
  it('ignora campos extras do payload real', () => {
    expect(isSubset({ a: 1, b: 2, c: 3 }, { a: 1 })).toBe(true);
  });

  it('falha quando o valor difere', () => {
    expect(isSubset({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('falha quando a chave não existe', () => {
    expect(isSubset({ a: 1 }, { z: 1 })).toBe(false);
  });

  it('compara objetos aninhados', () => {
    expect(isSubset({ p: { q: { r: 'x' } } }, { p: { q: { r: 'x' } } })).toBe(true);
    expect(isSubset({ p: { q: { r: 'x' } } }, { p: { q: { r: 'y' } } })).toBe(false);
  });

  it('exige que cada item esperado exista no array, em qualquer ordem', () => {
    expect(isSubset([{ id: 2 }, { id: 1 }], [{ id: 1 }])).toBe(true);
    expect(isSubset([{ id: 2 }], [{ id: 1 }])).toBe(false);
  });

  it('tolera número que chegou como string (query string)', () => {
    expect(isSubset({ id: '7' }, { id: 7 })).toBe(true);
  });
});

describe('evaluateApiCall', () => {
  it('passa quando a jornada chamou o endpoint', () => {
    const result = evaluateApiCall({ to: 'POST /agenda/consultas' }, [agendar]);
    expect(result.passed).toBe(true);
    expect(result.kind).toBe('apiCall');
  });

  it('falha quando a IA respondeu mas não chamou nada', () => {
    const result = evaluateApiCall({ to: 'POST /agenda/consultas' }, []);
    expect(result.passed).toBe(false);
    expect(result.actual).toContain('nenhuma chamada');
  });

  it('falha quando chamou o endpoint errado e mostra o que foi chamado', () => {
    const result = evaluateApiCall({ to: 'POST /agenda/consultas' }, [
      call('POST', '/crm/leads', { nome: 'Maria' }),
    ]);
    expect(result.passed).toBe(false);
    expect(result.actual).toContain('/crm/leads');
  });

  it('valida o payload enviado', () => {
    const ok = evaluateApiCall(
      { to: 'POST /agenda/consultas', bodyContains: { paciente_cpf: '123.456.789-00' } },
      [agendar],
    );
    expect(ok.passed).toBe(true);

    const wrong = evaluateApiCall(
      { to: 'POST /agenda/consultas', bodyContains: { paciente_cpf: '999.999.999-99' } },
      [agendar],
    );
    expect(wrong.passed).toBe(false);
    expect(wrong.actual).toContain('payload não bate');
  });

  it('pega chamada duplicada com times exato', () => {
    const result = evaluateApiCall({ to: 'POST /agenda/consultas', times: 1 }, [
      agendar,
      agendar,
    ]);
    expect(result.passed).toBe(false);
    expect(result.actual).toContain('2 chamada(s)');
  });

  it('aceita faixa em times', () => {
    expect(
      evaluateApiCall({ to: 'POST /agenda/consultas', times: { max: 2 } }, [agendar, agendar])
        .passed,
    ).toBe(true);
    expect(
      evaluateApiCall({ to: 'POST /agenda/consultas', times: { min: 3 } }, [agendar, agendar])
        .passed,
    ).toBe(false);
  });

  it('times 0 passa quando o endpoint não foi chamado', () => {
    expect(evaluateApiCall({ to: 'DELETE /agenda/*', times: 0 }, [agendar]).passed).toBe(true);
    expect(
      evaluateApiCall({ to: 'POST /agenda/consultas', times: 0 }, [agendar]).passed,
    ).toBe(false);
  });

  it('valida a query string', () => {
    const withQuery = call('GET', '/agenda/horarios', undefined, { data: '2026-06-12' });
    expect(
      evaluateApiCall({ to: 'GET /agenda/horarios', queryContains: { data: '2026-06-12' } }, [
        withQuery,
      ]).passed,
    ).toBe(true);
    expect(
      evaluateApiCall({ to: 'GET /agenda/horarios', queryContains: { data: '2026-01-01' } }, [
        withQuery,
      ]).passed,
    ).toBe(false);
  });
});

describe('evaluateNoApiCall', () => {
  it('passa quando o endpoint proibido não foi chamado', () => {
    const result = evaluateNoApiCall('DELETE /agenda/*', [agendar]);
    expect(result.passed).toBe(true);
    expect(result.kind).toBe('noApiCall');
  });

  it('falha e mostra a chamada indevida', () => {
    const result = evaluateNoApiCall('DELETE /agenda/*', [
      call('DELETE', '/agenda/consultas/987'),
    ]);
    expect(result.passed).toBe(false);
    expect(result.actual).toContain('/agenda/consultas/987');
  });
});
