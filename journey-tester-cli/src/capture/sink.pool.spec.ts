import { acquireSink, releaseSink, sinkUsers } from './sink.pool';

describe('pool do graph sink', () => {
  const options = { host: '127.0.0.1', port: 4610 };

  afterEach(async () => {
    // Garante que nenhuma porta fica presa entre testes.
    while (sinkUsers(options) > 0) {
      const sink = await acquireSink(options);
      await releaseSink(sink);
      await releaseSink(sink);
    }
  });

  it('cenários simultâneos dividem o mesmo servidor', async () => {
    const first = await acquireSink(options);
    const second = await acquireSink(options);

    expect(second).toBe(first);
    expect(sinkUsers(options)).toBe(2);

    await releaseSink(first);
    await releaseSink(second);
    expect(sinkUsers(options)).toBe(0);
  });

  /** Cenários em paralelo chamam acquire no mesmo tick. */
  it('acquire simultâneo sobe um servidor só', async () => {
    const sinks = await Promise.all([
      acquireSink(options),
      acquireSink(options),
      acquireSink(options),
    ]);

    expect(new Set(sinks).size).toBe(1);
    expect(sinkUsers(options)).toBe(3);

    await Promise.all(sinks.map((sink) => releaseSink(sink)));
    expect(sinkUsers(options)).toBe(0);
  });

  it('só para o servidor quando o último cenário solta', async () => {
    const first = await acquireSink(options);
    const second = await acquireSink(options);

    await releaseSink(first);
    // Ainda no ar: o segundo cenário continua rodando.
    await expect(fetch(`http://127.0.0.1:${options.port}/`)).resolves.toBeDefined();

    await releaseSink(second);
    await expect(fetch(`http://127.0.0.1:${options.port}/`)).rejects.toThrow();
  });

  it('portas diferentes não se confundem', async () => {
    const outra = { host: '127.0.0.1', port: 4611 };
    const first = await acquireSink(options);
    const second = await acquireSink(outra);

    expect(second).not.toBe(first);

    await releaseSink(first);
    await releaseSink(second);
  });

  it('soltar duas vezes não quebra', async () => {
    const sink = await acquireSink(options);
    await releaseSink(sink);
    await expect(releaseSink(sink)).resolves.toBeUndefined();
  });
});
