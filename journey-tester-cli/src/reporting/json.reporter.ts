import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { RunSummary } from '../runner/run-result.types';
import { logger } from '../shared/logger';

/** Relatório machine-readable para CI (artefato, histórico, dashboard futuro). */
export function writeJsonReport(summary: RunSummary, filePath: string): void {
  const absolute = resolve(filePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  logger.info(`relatório JSON em ${absolute}`);
}
