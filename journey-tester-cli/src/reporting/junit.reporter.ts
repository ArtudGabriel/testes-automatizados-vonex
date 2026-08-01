import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AssertionResult, RunSummary, ScenarioResult } from '../runner/run-result.types';
import { logger } from '../shared/logger';

/**
 * JUnit XML é o formato que GitHub Actions e GitLab renderizam nativamente
 * como lista de testes — o `--json` é para histórico, este é para o CI mostrar
 * qual turno quebrou sem ninguém abrir o log.
 */
export function writeJunitReport(summary: RunSummary, filePath: string): void {
  const absolute = resolve(filePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, renderJunit(summary), 'utf8');
  logger.info(`relatório JUnit em ${absolute}`);
}

export function renderJunit(summary: RunSummary): string {
  const suites = summary.scenarios.map((scenario) => renderSuite(scenario)).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="journey-tester" tests="${countTests(summary)}" failures="${countFailures(
      summary,
    )}" time="${seconds(summary.durationMs)}">`,
    suites,
    '</testsuites>',
    '',
  ].join('\n');
}

function renderSuite(scenario: ScenarioResult): string {
  const cases: string[] = [];

  for (const turn of scenario.turns) {
    const name = `turno ${turn.index + 1}: ${turn.userMessage}`;

    if (turn.timedOut) {
      cases.push(
        testCase(scenario, name, {
          message: 'a IA não respondeu dentro do timeout',
          detail: `esperado: resposta em até ${turn.latencyMs}ms`,
        }),
      );
      continue;
    }

    for (const assertion of turn.assertions) {
      cases.push(
        testCase(scenario, `${name} → [${assertion.kind}]`, failureOf(assertion)),
      );
    }

    if (turn.assertions.length === 0) {
      cases.push(testCase(scenario, name, undefined));
    }
  }

  for (const assertion of scenario.finalAssertions) {
    cases.push(testCase(scenario, `conversa → [${assertion.kind}]`, failureOf(assertion)));
  }

  if (scenario.error) {
    cases.push(
      testCase(scenario, 'execução do cenário', {
        message: 'cenário abortou',
        detail: scenario.error,
      }),
    );
  }

  const failures = cases.filter((entry) => entry.includes('<failure')).length;

  return [
    `  <testsuite name="${escapeXml(scenario.name)}" tests="${cases.length}" failures="${failures}" time="${seconds(
      scenario.durationMs,
    )}" file="${escapeXml(scenario.filePath)}">`,
    ...cases,
    '  </testsuite>',
  ].join('\n');
}

interface Failure {
  message: string;
  detail: string;
}

function failureOf(assertion: AssertionResult): Failure | undefined {
  if (assertion.passed) return undefined;
  return {
    message: `esperado: ${assertion.expected}`,
    detail: `recebido: ${assertion.actual}`,
  };
}

function testCase(scenario: ScenarioResult, name: string, failure?: Failure): string {
  const attrs = `classname="${escapeXml(scenario.name)}" name="${escapeXml(name)}"`;

  if (!failure) return `    <testcase ${attrs} />`;

  return [
    `    <testcase ${attrs}>`,
    `      <failure message="${escapeXml(failure.message)}">${escapeXml(failure.detail)}</failure>`,
    '    </testcase>',
  ].join('\n');
}

function countTests(summary: RunSummary): number {
  return summary.scenarios.reduce(
    (total, scenario) =>
      total +
      scenario.turns.reduce(
        (turnTotal, turn) => turnTotal + Math.max(1, turn.assertions.length),
        0,
      ) +
      scenario.finalAssertions.length +
      (scenario.error ? 1 : 0),
    0,
  );
}

function countFailures(summary: RunSummary): number {
  return summary.scenarios.reduce(
    (total, scenario) =>
      total +
      scenario.turns.reduce(
        (turnTotal, turn) =>
          turnTotal +
          (turn.timedOut ? 1 : turn.assertions.filter((entry) => !entry.passed).length),
        0,
      ) +
      scenario.finalAssertions.filter((entry) => !entry.passed).length +
      (scenario.error ? 1 : 0),
    0,
  );
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Caracteres de controle são inválidos em XML 1.0 e quebram o parser do CI.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}
