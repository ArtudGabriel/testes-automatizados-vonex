import type { OutboundMessage } from '../shared/whatsapp.types';

export type AssertionKind =
  | 'contains'
  | 'notContains'
  | 'matches'
  | 'judge'
  | 'maxLatencyMs'
  | 'messageCount';

export interface AssertionResult {
  kind: AssertionKind;
  passed: boolean;
  /** O que o cenário pediu. */
  expected: string;
  /** O que a IA entregou (ou a explicação do judge). */
  actual: string;
}

export interface TurnResult {
  index: number;
  userMessage: string;
  /** true quando o turno foi o clique num botão, não texto digitado. */
  isOptionReply: boolean;
  botMessages: OutboundMessage[];
  latencyMs: number;
  timedOut: boolean;
  assertions: AssertionResult[];
  passed: boolean;
}

export interface ScenarioResult {
  name: string;
  filePath: string;
  adapter: string;
  mode: 'steps' | 'persona';
  passed: boolean;
  durationMs: number;
  turns: TurnResult[];
  /** Asserções avaliadas sobre a conversa inteira (modo persona). */
  finalAssertions: AssertionResult[];
  /** Preenchido quando o cenário aborta (erro de transporte, config, etc). */
  error?: string;
  /** Modo persona: se o objetivo declarado foi atingido. */
  goalAchieved?: boolean;
  /** Modo persona: rótulo do arquétipo usado. */
  persona?: string;
  /** Nome do projeto/jornada sob teste. */
  project?: string;
}

export interface RunSummary {
  startedAt: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  scenarios: ScenarioResult[];
}

export function summarize(scenarios: ScenarioResult[], durationMs: number, startedAt: Date): RunSummary {
  const passed = scenarios.filter((scenario) => scenario.passed).length;
  return {
    startedAt: startedAt.toISOString(),
    durationMs,
    total: scenarios.length,
    passed,
    failed: scenarios.length - passed,
    scenarios,
  };
}
