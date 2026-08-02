import { getProviderProfile, isConnectedState } from './provider.profile';
import type { AppConfig } from '../../config/env.config';

describe('isConnectedState', () => {
  it('lê o shape do Evolution (instance.state)', () => {
    expect(isConnectedState({ instance: { instanceName: 'teste', state: 'open' } })).toBe(true);
    expect(isConnectedState({ instance: { state: 'close' } })).toBe(false);
    expect(isConnectedState({ instance: { state: 'connecting' } })).toBe(false);
  });

  it('lê estado no nível raiz', () => {
    expect(isConnectedState({ state: 'open' })).toBe(true);
    expect(isConnectedState({ status: 'disconnected' })).toBe(false);
  });

  it('lê booleano connected (Z-API)', () => {
    expect(isConnectedState({ connected: true })).toBe(true);
    expect(isConnectedState({ connected: false })).toBe(false);
  });

  it('lê estado dentro de data', () => {
    expect(isConnectedState({ data: { status: 'connected' } })).toBe(true);
  });

  it('devolve undefined para shape desconhecido, em vez de chutar', () => {
    expect(isConnectedState({ foo: 'bar' })).toBeUndefined();
    expect(isConnectedState(null)).toBeUndefined();
    expect(isConnectedState({ state: 'algo-novo' })).toBeUndefined();
  });

  it('ignora caixa', () => {
    expect(isConnectedState({ state: 'OPEN' })).toBe(true);
  });
});

describe('health por provedor', () => {
  const config = {
    WA_PROVIDER_BASE_URL: 'http://localhost:8080',
    WA_PROVIDER_INSTANCE: 'teste',
    WA_PROVIDER_TOKEN: 'TOK',
  } as AppConfig;

  it('Evolution consulta connectionState da instância', () => {
    expect(getProviderProfile('evolution').health?.(config)).toEqual({
      method: 'GET',
      path: '/instance/connectionState/teste',
    });
  });

  it('todo provedor expõe health, para o doctor checar a sessão', () => {
    for (const provider of ['z-api', 'evolution', 'uazapi'] as const) {
      expect(getProviderProfile(provider).health).toBeDefined();
    }
  });
});
