import { ApiSpyServer, matchesTarget } from './api-spy.server';
import { apiStubSchema } from '../scenario/api-spy.schema';

describe('matchesTarget', () => {
  const call = { method: 'POST', path: '/agenda/consultas' };

  it('casa método e caminho exatos', () => {
    expect(matchesTarget(call, 'POST /agenda/consultas')).toBe(true);
  });

  it('não casa método diferente', () => {
    expect(matchesTarget(call, 'GET /agenda/consultas')).toBe(false);
  });

  it('não casa caminho diferente', () => {
    expect(matchesTarget(call, 'POST /agenda/pacientes')).toBe(false);
  });

  it('aceita curinga no caminho', () => {
    expect(matchesTarget(call, 'POST /agenda/*')).toBe(true);
    expect(matchesTarget(call, 'POST /*/consultas')).toBe(true);
  });

  it('sem método declarado, casa qualquer verbo', () => {
    expect(matchesTarget(call, '/agenda/consultas')).toBe(true);
    expect(matchesTarget({ method: 'DELETE', path: '/agenda/consultas' }, '/agenda/consultas')).toBe(
      true,
    );
  });

  it('tolera barra final', () => {
    expect(matchesTarget({ method: 'GET', path: '/agenda/' }, 'GET /agenda')).toBe(true);
  });

  it('não deixa ponto do padrão virar curinga de regex', () => {
    expect(matchesTarget({ method: 'GET', path: '/vXbeta' }, 'GET /v.beta')).toBe(false);
  });
});

describe('ApiSpyServer', () => {
  let spy: ApiSpyServer;
  let baseUrl: string;

  async function start(stubs: unknown[] = []): Promise<void> {
    const port = 4100 + Math.floor(Math.random() * 300);
    spy = new ApiSpyServer({
      host: '127.0.0.1',
      port,
      stubs: stubs.map((stub) => apiStubSchema.parse(stub)),
    });
    await spy.start();
    baseUrl = `http://127.0.0.1:${port}`;
  }

  afterEach(async () => {
    await spy?.stop();
  });

  it('registra método, caminho, query e corpo', async () => {
    await start();

    await fetch(`${baseUrl}/agenda/consultas?clinica=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paciente: 'Maria', horario: '14:30' }),
    });

    const [call] = spy.allCalls();
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe('/agenda/consultas');
    expect(call?.query).toEqual({ clinica: '1' });
    expect(call?.body).toEqual({ paciente: 'Maria', horario: '14:30' });
  });

  it('responde com o stub configurado', async () => {
    await start([
      { match: 'POST /agenda/consultas', respond: { status: 201, body: { id: 987 } } },
    ]);

    const response = await fetch(`${baseUrl}/agenda/consultas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 987 });
    expect(spy.allCalls()[0]?.matchedStub).toBe('POST /agenda/consultas');
  });

  it('usa o primeiro stub que casar', async () => {
    await start([
      { match: 'POST /agenda/consultas', respond: { body: { origem: 'especifico' } } },
      { match: 'POST /agenda/*', respond: { body: { origem: 'generico' } } },
    ]);

    const response = await fetch(`${baseUrl}/agenda/consultas`, { method: 'POST' });
    expect(await response.json()).toEqual({ origem: 'especifico' });
  });

  it('responde 200 vazio e marca sem stub quando nada casa', async () => {
    await start([{ match: 'GET /outra-coisa' }]);

    const response = await fetch(`${baseUrl}/agenda/consultas`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(spy.allCalls()[0]?.matchedStub).toBeUndefined();
  });

  it('redige cabeçalho de credencial', async () => {
    await start();

    await fetch(`${baseUrl}/qualquer`, {
      headers: { authorization: 'Bearer segredo-do-cliente', 'x-api-key': 'chave' },
    });

    const headers = spy.allCalls()[0]?.headers ?? {};
    expect(headers.authorization).toBe('[redacted]');
    expect(headers['x-api-key']).toBe('[redacted]');
    expect(JSON.stringify(headers)).not.toContain('segredo-do-cliente');
  });

  it('callsSince devolve só o que veio depois do marcador', async () => {
    await start();

    await fetch(`${baseUrl}/primeira`, { method: 'GET' });
    const marker = spy.callCount;
    await fetch(`${baseUrl}/segunda`, { method: 'GET' });

    const recent = spy.callsSince(marker);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.path).toBe('/segunda');
  });
});
