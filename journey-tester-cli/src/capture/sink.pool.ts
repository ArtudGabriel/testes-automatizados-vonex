import { GraphSinkServer, type GraphSinkOptions } from './graph-sink.server';

interface PoolEntry {
  /**
   * A promessa, não o servidor já pronto: cenários simultâneos chamam
   * `acquire` no mesmo tick, e guardar só o resultado faria cada um subir o
   * seu servidor — todos menos o primeiro morrendo com EADDRINUSE.
   */
  starting: Promise<GraphSinkServer>;
  users: number;
}

const pool = new Map<string, PoolEntry>();

function keyOf(options: Pick<GraphSinkOptions, 'host' | 'port'>): string {
  return `${options.host}:${options.port}`;
}

/**
 * Um sink por host:porta, compartilhado entre cenários.
 *
 * A porta do sink não pode variar por cenário: ela está configurada na base URL
 * da Cloud API do ambiente de teste da vonex.ai. Então cenários simultâneos
 * dividem o mesmo servidor e cada adapter filtra o que é seu pelo número do
 * contato.
 */
export async function acquireSink(options: GraphSinkOptions): Promise<GraphSinkServer> {
  const key = keyOf(options);
  const existing = pool.get(key);

  if (existing) {
    existing.users += 1;
    return existing.starting;
  }

  const sink = new GraphSinkServer(options);
  const starting = sink.start().then(() => sink);
  pool.set(key, { starting, users: 1 });

  try {
    return await starting;
  } catch (error) {
    // Porta ocupada por outra coisa: não deixar entrada quebrada no pool.
    pool.delete(key);
    throw error;
  }
}

/** Para o servidor quando o último cenário que o usava termina. */
export async function releaseSink(sink: GraphSinkServer): Promise<void> {
  for (const [key, entry] of pool.entries()) {
    if ((await entry.starting.catch(() => undefined)) !== sink) continue;

    entry.users -= 1;
    if (entry.users > 0) return;

    pool.delete(key);
    await sink.stop();
    return;
  }

  // Sink que não veio do pool: para do mesmo jeito, para não vazar porta.
  await sink.stop();
}

/** Quantos cenários seguram o sink desta porta. Só para teste e diagnóstico. */
export function sinkUsers(options: Pick<GraphSinkOptions, 'host' | 'port'>): number {
  return pool.get(keyOf(options))?.users ?? 0;
}
