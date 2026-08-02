import { runInPool } from './scenario.pool';

describe('runInPool', () => {
  it('preserva a ordem de entrada, não a de conclusão', async () => {
    const results = await runInPool([30, 10, 20], 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });

    expect(results).toEqual([30, 10, 20]);
  });

  it('respeita o teto de execuções simultâneas', async () => {
    let running = 0;
    let peak = 0;

    await runInPool([1, 2, 3, 4, 5, 6], 2, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running -= 1;
    });

    expect(peak).toBe(2);
  });

  it('com teto 1, roda tudo em sequência', async () => {
    const order: number[] = [];

    await runInPool([1, 2, 3], 1, async (item) => {
      order.push(item);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(-item);
    });

    expect(order).toEqual([1, -1, 2, -2, 3, -3]);
  });

  it('lista vazia não trava', async () => {
    await expect(runInPool([], 4, async () => 1)).resolves.toEqual([]);
  });
});
