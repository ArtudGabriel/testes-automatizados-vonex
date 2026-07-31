import { matchesTarget, type RecordedApiCall } from '../capture/api-spy.server';
import type { ApiCallAssertionSpec } from '../scenario/api-spy.schema';
import type { AssertionResult } from '../runner/run-result.types';
import { truncate } from '../shared/text.util';

/**
 * Verifica se a jornada chamou a API externa como deveria. Cobre três bugs que
 * a asserção de texto não pega: payload errado, chamada que não aconteceu
 * (a IA respondeu "agendado!" sem agendar) e chamada duplicada.
 */
export function evaluateApiCall(
  spec: ApiCallAssertionSpec,
  calls: RecordedApiCall[],
): AssertionResult {
  const byTarget = calls.filter((call) => matchesTarget(call, spec.to));
  const matching = byTarget.filter((call) => matchesPayload(spec, call));

  const expected = describeExpectation(spec);

  if (byTarget.length === 0) {
    return {
      kind: 'apiCall',
      passed: expectsZero(spec.times),
      expected,
      actual: calls.length === 0 ? 'nenhuma chamada à API' : `chamadas: ${describeCalls(calls)}`,
    };
  }

  if (matching.length === 0) {
    return {
      kind: 'apiCall',
      passed: expectsZero(spec.times),
      expected,
      actual: `chamou ${spec.to}, mas o payload não bate: ${describePayloads(byTarget)}`,
    };
  }

  return {
    kind: 'apiCall',
    passed: matchesCount(spec.times, matching.length),
    expected,
    actual: `${matching.length} chamada(s): ${describePayloads(matching)}`,
  };
}

export function evaluateNoApiCall(target: string, calls: RecordedApiCall[]): AssertionResult {
  const matching = calls.filter((call) => matchesTarget(call, target));
  return {
    kind: 'noApiCall',
    passed: matching.length === 0,
    expected: `não chamar ${target}`,
    actual:
      matching.length === 0
        ? 'não chamou'
        : `chamou ${matching.length}x: ${describePayloads(matching)}`,
  };
}

function matchesPayload(spec: ApiCallAssertionSpec, call: RecordedApiCall): boolean {
  if (spec.bodyContains !== undefined && !isSubset(call.body, spec.bodyContains)) {
    return false;
  }
  if (spec.queryContains !== undefined && !isSubset(call.query, spec.queryContains)) {
    return false;
  }
  return true;
}

function matchesCount(times: ApiCallAssertionSpec['times'], actual: number): boolean {
  if (times === undefined) return actual >= 1;
  if (typeof times === 'number') return actual === times;

  const withinMin = times.min === undefined || actual >= times.min;
  const withinMax = times.max === undefined || actual <= times.max;
  return withinMin && withinMax;
}

function expectsZero(times: ApiCallAssertionSpec['times']): boolean {
  if (times === undefined) return false;
  if (typeof times === 'number') return times === 0;
  return times.max === 0;
}

/**
 * Subconjunto profundo: tudo que o cenário declarou precisa estar no valor
 * recebido. Campos extras no payload real são ignorados — o cenário não deve
 * quebrar porque a jornada passou a mandar um campo novo.
 */
export function isSubset(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') {
    return Object.is(actual, expected) || String(actual) === String(expected);
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((item) => actual.some((entry) => isSubset(entry, item)));
  }

  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;

  const actualRecord = actual as Record<string, unknown>;
  return Object.entries(expected as Record<string, unknown>).every(([key, value]) =>
    isSubset(actualRecord[key], value),
  );
}

function describeExpectation(spec: ApiCallAssertionSpec): string {
  const parts: string[] = [`chamar ${spec.to}`];

  if (typeof spec.times === 'number') {
    parts.push(`${spec.times}x`);
  } else if (spec.times) {
    const bounds = [
      spec.times.min === undefined ? undefined : `min ${spec.times.min}`,
      spec.times.max === undefined ? undefined : `max ${spec.times.max}`,
    ]
      .filter(Boolean)
      .join(', ');
    parts.push(`(${bounds})`);
  }

  if (spec.bodyContains !== undefined) {
    parts.push(`com body contendo ${JSON.stringify(spec.bodyContains)}`);
  }
  if (spec.queryContains !== undefined) {
    parts.push(`com query contendo ${JSON.stringify(spec.queryContains)}`);
  }

  return parts.join(' ');
}

function describeCalls(calls: RecordedApiCall[]): string {
  if (calls.length === 0) return 'nenhuma';
  return calls.map((call) => `${call.method} ${call.path}`).join(', ');
}

function describePayloads(calls: RecordedApiCall[]): string {
  return calls
    .map((call) => {
      const body = call.body === undefined ? '' : ` ${JSON.stringify(call.body)}`;
      return truncate(`${call.method} ${call.path}${body}`, 200);
    })
    .join(' | ');
}
