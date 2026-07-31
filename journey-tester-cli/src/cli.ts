#!/usr/bin/env node
import { Command } from 'commander';
import { createAdapter } from './adapters/adapter.factory';
import { getConfig } from './config/env.config';
import {
  reportScenarioHeader,
  reportScenarioResult,
  reportSummary,
  reportTurn,
} from './reporting/console.reporter';
import { writeJsonReport } from './reporting/json.reporter';
import { summarize, type ScenarioResult } from './runner/run-result.types';
import { ScenarioRunner } from './runner/scenario.runner';
import { PERSONA_ARCHETYPES } from './persona/archetypes';
import { describePersona } from './persona/persona.simulator';
import { loadScenarios } from './scenario/scenario.loader';
import { ADAPTER_NAMES, type AdapterName } from './scenario/scenario.schema';
import { logger, setLogLevel, type LogLevel } from './shared/logger';

interface RunCommandOptions {
  adapter?: AdapterName;
  json?: string;
  continueOnFailure: boolean;
  logLevel: LogLevel;
}

const program = new Command();

program
  .name('journey-tester')
  .description('Testa jornadas de IA no WhatsApp a partir de cenários declarativos')
  .version('0.1.0');

program
  .command('run')
  .argument('<paths...>', 'arquivos .yaml de cenário ou diretórios')
  .option(
    '-a, --adapter <name>',
    `sobrescreve o adapter do cenário (${ADAPTER_NAMES.join(' | ')})`,
  )
  .option('-j, --json <file>', 'grava o relatório em JSON')
  .option('--continue-on-failure', 'não para o cenário no primeiro turno que falhar', false)
  .option('-l, --log-level <level>', 'silent | error | warn | info | debug', 'info')
  .action(async (paths: string[], options: RunCommandOptions) => {
    setLogLevel(options.logLevel);

    if (options.adapter && !ADAPTER_NAMES.includes(options.adapter)) {
      logger.error(`adapter inválido: ${options.adapter}`);
      process.exitCode = 2;
      return;
    }

    const startedAt = new Date();
    const started = Date.now();
    const results: ScenarioResult[] = [];

    try {
      const config = getConfig();
      const scenarios = loadScenarios(paths);

      if (scenarios.length === 0) {
        logger.error('nenhum cenário encontrado nos caminhos informados');
        process.exitCode = 2;
        return;
      }

      for (const scenario of scenarios) {
        const adapterName: AdapterName = options.adapter ?? scenario.spec.adapter ?? 'http';
        reportScenarioHeader({
          name: scenario.spec.name,
          adapter: adapterName,
          ...(scenario.spec.persona
            ? { persona: describePersona(scenario.spec.persona) }
            : {}),
          ...(scenario.project ? { project: scenario.project.name } : {}),
        });

        const runner = new ScenarioRunner(createAdapter(adapterName, config), {
          stopOnFailure: !options.continueOnFailure,
          onTurn: reportTurn,
        });

        const result = await runner.run(scenario);
        reportScenarioResult(result);
        results.push(result);
      }
    } catch (error) {
      logger.error((error as Error).message);
      process.exitCode = 2;
      return;
    }

    const summary = summarize(results, Date.now() - started, startedAt);
    reportSummary(summary);

    if (options.json) {
      writeJsonReport(summary, options.json);
    }

    process.exitCode = summary.failed > 0 ? 1 : 0;
  });

program
  .command('personas')
  .description('lista os tipos de cliente disponíveis para o modo persona')
  .option('-v, --verbose', 'mostra comportamento e táticas de cada arquétipo', false)
  .action((options: { verbose: boolean }) => {
    for (const archetype of PERSONA_ARCHETYPES) {
      process.stdout.write(`\n${archetype.id}  —  ${archetype.label}\n`);
      process.stdout.write(`  ${archetype.summary}\n`);

      if (options.verbose) {
        process.stdout.write(`\n  Comportamento:\n`);
        for (const line of archetype.behavior.split('\n')) {
          process.stdout.write(`    ${line.trim()}\n`);
        }
        process.stdout.write(`\n  Táticas:\n`);
        for (const tactic of archetype.tactics) {
          process.stdout.write(`    - ${tactic}\n`);
        }
        process.stdout.write(`\n  Sucesso: ${archetype.successHint}\n`);
      }
    }
    process.stdout.write(`\n${PERSONA_ARCHETYPES.length} arquétipos. Use em persona.archetype\n`);
  });

program
  .command('validate')
  .description('valida os cenários sem chamar a plataforma')
  .argument('<paths...>', 'arquivos .yaml de cenário ou diretórios')
  .action((paths: string[]) => {
    try {
      const scenarios = loadScenarios(paths);
      for (const scenario of scenarios) {
        const mode = scenario.spec.persona
          ? `persona: ${describePersona(scenario.spec.persona)}`
          : `${scenario.spec.steps?.length} passo(s)`;
        const project = scenario.project ? ` · ${scenario.project.name}` : '';
        process.stdout.write(`✓ ${scenario.spec.name} (${mode})${project} — ${scenario.filePath}\n`);
      }
      process.stdout.write(`\n${scenarios.length} cenário(s) válido(s)\n`);
    } catch (error) {
      logger.error((error as Error).message);
      process.exitCode = 2;
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  logger.error((error as Error).message);
  process.exitCode = 2;
});
