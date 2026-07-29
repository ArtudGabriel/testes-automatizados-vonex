import type { AssertionSpec } from '../scenario/scenario.schema';
import type { AssertionResult } from '../runner/run-result.types';
import { includesNormalized, truncate } from '../shared/text.util';
import type { OutboundMessage } from '../shared/whatsapp.types';

export interface TurnSnapshot {
  messages: OutboundMessage[];
  latencyMs: number;
}

/** Texto do turno = todas as mensagens + os títulos das opções oferecidas. */
export function flattenTurn(messages: OutboundMessage[]): string {
  return messages
    .map((message) => {
      const options = message.options.map((option) => option.title).join(' | ');
      return options ? `${message.text}\n[opções: ${options}]` : message.text;
    })
    .join('\n')
    .trim();
}

export function evaluateContains(spec: string, turn: TurnSnapshot): AssertionResult {
  const text = flattenTurn(turn.messages);
  return {
    kind: 'contains',
    passed: includesNormalized(text, spec),
    expected: `contém "${spec}"`,
    actual: truncate(text) || '(sem resposta)',
  };
}

export function evaluateNotContains(spec: string, turn: TurnSnapshot): AssertionResult {
  const text = flattenTurn(turn.messages);
  return {
    kind: 'notContains',
    passed: !includesNormalized(text, spec),
    expected: `não contém "${spec}"`,
    actual: truncate(text) || '(sem resposta)',
  };
}

export function evaluateMatches(spec: string, turn: TurnSnapshot): AssertionResult {
  const text = flattenTurn(turn.messages);
  let passed: boolean;
  try {
    passed = new RegExp(spec, 'i').test(text);
  } catch (error) {
    return {
      kind: 'matches',
      passed: false,
      expected: `regex /${spec}/i`,
      actual: `regex inválida: ${(error as Error).message}`,
    };
  }
  return {
    kind: 'matches',
    passed,
    expected: `regex /${spec}/i`,
    actual: truncate(text) || '(sem resposta)',
  };
}

export function evaluateMaxLatency(spec: number, turn: TurnSnapshot): AssertionResult {
  return {
    kind: 'maxLatencyMs',
    passed: turn.latencyMs <= spec,
    expected: `resposta em até ${spec}ms`,
    actual: `${turn.latencyMs}ms`,
  };
}

export function evaluateMessageCount(
  spec: NonNullable<AssertionSpec['messageCount']>,
  turn: TurnSnapshot,
): AssertionResult {
  const count = turn.messages.length;
  const withinMin = spec.min === undefined || count >= spec.min;
  const withinMax = spec.max === undefined || count <= spec.max;

  const bounds = [
    spec.min === undefined ? undefined : `min ${spec.min}`,
    spec.max === undefined ? undefined : `max ${spec.max}`,
  ]
    .filter(Boolean)
    .join(', ');

  return {
    kind: 'messageCount',
    passed: withinMin && withinMax,
    expected: `quantidade de mensagens (${bounds})`,
    actual: String(count),
  };
}
