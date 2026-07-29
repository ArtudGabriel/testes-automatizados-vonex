import pc from 'picocolors';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: Exclude<LogLevel, 'silent'>): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[currentLevel];
}

/**
 * Todo log vai para stderr. stdout fica reservado para o relatório,
 * o que mantém `--json` pipeável.
 */
function write(prefix: string, message: string, context?: unknown): void {
  const suffix = context === undefined ? '' : ` ${JSON.stringify(context)}`;
  process.stderr.write(`${prefix} ${message}${suffix}\n`);
}

export const logger = {
  error(message: string, context?: unknown): void {
    if (shouldLog('error')) write(pc.red('[error]'), message, context);
  },
  warn(message: string, context?: unknown): void {
    if (shouldLog('warn')) write(pc.yellow('[warn] '), message, context);
  },
  info(message: string, context?: unknown): void {
    if (shouldLog('info')) write(pc.blue('[info] '), message, context);
  },
  debug(message: string, context?: unknown): void {
    if (shouldLog('debug')) write(pc.dim('[debug]'), message, context);
  },
};
