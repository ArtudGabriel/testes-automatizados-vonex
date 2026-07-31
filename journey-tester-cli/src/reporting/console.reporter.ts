import pc from 'picocolors';
import type {
  AssertionResult,
  RunSummary,
  ScenarioResult,
  TurnResult,
} from '../runner/run-result.types';
import { flattenTurn } from '../assertions/deterministic.evaluator';
import { indentLines, truncate } from '../shared/text.util';

const PASS = pc.green('✓');
const FAIL = pc.red('✗');

function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

export function reportScenarioHeader(scenario: {
  name: string;
  adapter: string;
  persona?: string;
  project?: string;
}): void {
  out();
  const meta = [
    `adapter ${scenario.adapter}`,
    ...(scenario.project ? [scenario.project] : []),
    ...(scenario.persona ? [scenario.persona] : []),
  ].join(' · ');
  out(pc.bold(scenario.name) + pc.dim(` · ${meta}`));
}

export function reportTurn(turn: TurnResult): void {
  const marker = turn.passed ? PASS : FAIL;
  const label = turn.isOptionReply ? pc.cyan(turn.userMessage) : turn.userMessage;
  out(`  ${marker} ${pc.dim(`turno ${turn.index + 1}`)}  ${pc.bold('→')} ${label}`);

  if (turn.timedOut) {
    out(pc.red(`      ${FAIL} a IA não respondeu em tempo`));
    return;
  }

  const botText = flattenTurn(turn.botMessages) || '(sem resposta)';
  out(indentLines(pc.dim(truncate(botText, 400)), '      ← '));
  out(
    pc.dim(
      `      ${turn.botMessages.length} mensagem(ns) · primeira resposta em ${turn.latencyMs}ms`,
    ),
  );

  for (const assertion of turn.assertions) {
    reportAssertion(assertion, '      ');
  }
}

function reportAssertion(assertion: AssertionResult, indent: string): void {
  const marker = assertion.passed ? PASS : FAIL;
  const kind = pc.dim(`[${assertion.kind}]`);
  out(`${indent}${marker} ${kind} ${assertion.expected}`);
  if (!assertion.passed) {
    out(`${indent}    ${pc.red('recebido:')} ${truncate(assertion.actual, 400)}`);
  }
}

export function reportScenarioResult(scenario: ScenarioResult): void {
  if (scenario.error) {
    out(`  ${FAIL} ${pc.red(`abortou: ${scenario.error}`)}`);
  }

  if (scenario.mode === 'persona') {
    const goal = scenario.goalAchieved
      ? pc.green('objetivo atingido')
      : pc.yellow('objetivo não atingido');
    const who = scenario.persona ? `${scenario.persona}: ` : '';
    out(`  ${pc.dim(who)}${goal} em ${scenario.turns.length} turno(s)`);
  }

  for (const assertion of scenario.finalAssertions) {
    reportAssertion(assertion, '  ');
  }

  const marker = scenario.passed ? PASS : FAIL;
  const status = scenario.passed ? pc.green('PASSOU') : pc.red('FALHOU');
  out(`  ${marker} ${status} ${pc.dim(`(${scenario.durationMs}ms)`)}`);
}

export function reportSummary(summary: RunSummary): void {
  out();
  out(pc.bold('─'.repeat(56)));

  for (const scenario of summary.scenarios.filter((entry) => !entry.passed)) {
    out(`${FAIL} ${scenario.name} ${pc.dim(scenario.filePath)}`);
  }

  const parts = [
    `${summary.total} cenário(s)`,
    pc.green(`${summary.passed} passou(aram)`),
    summary.failed > 0 ? pc.red(`${summary.failed} falhou(aram)`) : pc.dim('0 falhou'),
    pc.dim(`${summary.durationMs}ms`),
  ];
  out(parts.join(pc.dim(' · ')));
}
