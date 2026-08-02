/**
 * Roda os itens com no máximo `concurrency` em voo, preservando a ordem de
 * entrada no resultado — o relatório final não pode depender de quem terminou
 * primeiro.
 */
export async function runInPool<T, R>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await run(item);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
