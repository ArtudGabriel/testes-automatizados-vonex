import type { AppConfig } from '../../config/env.config';
import { getProviderProfile, UNOFFICIAL_PROVIDERS } from './provider.profile';

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    WA_PROVIDER_BASE_URL: 'https://provedor.example',
    WA_PROVIDER_INSTANCE: 'INST',
    WA_PROVIDER_TOKEN: 'TOK',
    WA_PROVIDER_POLL_AMOUNT: 20,
    ...overrides,
  } as AppConfig;
}

describe('perfis de provedor', () => {
  it('cobre os três provedores suportados', () => {
    expect([...UNOFFICIAL_PROVIDERS]).toEqual(['z-api', 'evolution', 'uazapi']);
  });

  it('Z-API põe instância e token no caminho', () => {
    const profile = getProviderProfile('z-api');
    expect(profile.baseUrl(config())).toBe('https://provedor.example/instances/INST/token/TOK');

    const send = profile.send(config(), '5511999999999', 'oi');
    expect(send).toMatchObject({
      method: 'POST',
      path: '/send-text',
      body: { phone: '5511999999999', message: 'oi' },
    });
  });

  it('Z-API só manda Client-Token quando existe', () => {
    const profile = getProviderProfile('z-api');
    expect(profile.authHeaders(config())).toEqual({});
    expect(profile.authHeaders(config({ WA_PROVIDER_CLIENT_TOKEN: 'CT' }))).toEqual({
      'client-token': 'CT',
    });
  });

  it('Evolution usa header apikey e instância no caminho da rota', () => {
    const profile = getProviderProfile('evolution');
    expect(profile.baseUrl(config())).toBe('https://provedor.example');
    expect(profile.authHeaders(config())).toEqual({ apikey: 'TOK' });

    const send = profile.send(config(), '5511999999999', 'oi');
    expect(send).toMatchObject({
      method: 'POST',
      path: '/message/sendText/INST',
      body: { number: '5511999999999', text: 'oi' },
    });
  });

  it('Evolution filtra por remoteJid ao ler o chat', () => {
    const fetchMessages = getProviderProfile('evolution').fetchMessages;
    const call = fetchMessages?.(config(), '5511999999999');
    expect(call?.path).toBe('/chat/findMessages/INST');
    expect(call?.body).toMatchObject({
      where: { key: { remoteJid: '5511999999999@s.whatsapp.net' } },
    });
  });

  it('Uazapi usa header token', () => {
    const profile = getProviderProfile('uazapi');
    expect(profile.authHeaders(config())).toEqual({ token: 'TOK' });
    expect(profile.send(config(), '55119', 'oi').body).toMatchObject({
      number: '55119',
      text: 'oi',
    });
  });

  it('todo provedor expõe leitura de histórico (polling sem túnel)', () => {
    for (const provider of UNOFFICIAL_PROVIDERS) {
      expect(getProviderProfile(provider).fetchMessages).toBeDefined();
    }
  });

  it('env sobrescreve caminho e header quando o contrato divergir', () => {
    const custom = config({
      WA_PROVIDER_SEND_PATH: '/custom/send',
      WA_PROVIDER_FETCH_PATH: '/custom/find',
      WA_PROVIDER_AUTH_HEADER: 'x-minha-chave',
    });

    const profile = getProviderProfile('evolution');
    expect(profile.send(custom, '1', 'x').path).toBe('/custom/send/INST');
    expect(profile.fetchMessages?.(custom, '1').path).toBe('/custom/find/INST');
    expect(profile.authHeaders(custom)).toEqual({ 'x-minha-chave': 'TOK' });
  });

  it('falha com mensagem clara quando falta token ou instância', () => {
    expect(() => getProviderProfile('evolution').authHeaders(config({ WA_PROVIDER_TOKEN: undefined })))
      .toThrow(/WA_PROVIDER_TOKEN/);
    expect(() =>
      getProviderProfile('z-api').baseUrl(config({ WA_PROVIDER_INSTANCE: undefined })),
    ).toThrow(/WA_PROVIDER_INSTANCE/);
  });
});
