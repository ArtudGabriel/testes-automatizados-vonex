import {
  extractMessageList,
  extractTimestamp,
  normalizeProviderMessage,
  providerMessageId,
} from './unofficial-message';

describe('formato plano (Z-API)', () => {
  it('lê texto em text.message', () => {
    const message = normalizeProviderMessage(
      {
        phone: '5511999999999',
        fromMe: false,
        messageId: 'ABC123',
        momment: 1_780_000_000_000,
        text: { message: 'Olá! Como posso ajudar?' },
      },
      0,
    );

    expect(message?.text).toBe('Olá! Como posso ajudar?');
    expect(message?.to).toBe('5511999999999');
    // receivedAt é a hora de observação; o relógio do provedor fica à parte.
    expect(message?.receivedAt).toBe(0);
    expect(message?.providerTimestamp).toBe(1_780_000_000_000);
  });

  it('extrai botões oferecidos', () => {
    const message = normalizeProviderMessage(
      {
        phone: '1',
        fromMe: false,
        buttonsMessage: {
          message: 'Escolha um horário:',
          buttons: [
            { id: 'h1', label: '09:00' },
            { id: 'h2', label: '14:00' },
          ],
        },
      },
      0,
    );

    expect(message?.kind).toBe('interactive');
    expect(message?.options).toEqual([
      { id: 'h1', title: '09:00' },
      { id: 'h2', title: '14:00' },
    ]);
  });
});

describe('formato Baileys (Evolution / Uazapi)', () => {
  const baileys = (content: unknown, overrides: Record<string, unknown> = {}) => ({
    key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: '3EB0ABC' },
    message: content,
    messageTimestamp: 1_780_000_000,
    ...overrides,
  });

  it('lê conversation', () => {
    const message = normalizeProviderMessage(baileys({ conversation: 'Bom dia!' }), 12_345);
    expect(message?.text).toBe('Bom dia!');
    expect(message?.to).toBe('5511999999999');
    expect(message?.receivedAt).toBe(12_345);
    expect(message?.providerTimestamp).toBe(1_780_000_000_000);
  });

  it('nunca usa o relógio do provedor como hora de chegada', () => {
    // messageTimestamp em segundos: se virasse receivedAt, a latência do turno
    // ficaria negativa e `maxLatencyMs` passaria falsamente.
    const observedAt = Date.now();
    const message = normalizeProviderMessage(baileys({ conversation: 'oi' }), observedAt);
    expect(message?.receivedAt).toBe(observedAt);
    expect(message?.receivedAt).not.toBe(message?.providerTimestamp);
  });

  it('lê extendedTextMessage', () => {
    const message = normalizeProviderMessage(
      baileys({ extendedTextMessage: { text: 'resposta longa' } }),
      0,
    );
    expect(message?.text).toBe('resposta longa');
  });

  it('desembrulha o envelope de webhook em data', () => {
    const message = normalizeProviderMessage(
      { event: 'messages.upsert', instance: 'teste', data: baileys({ conversation: 'oi' }) },
      0,
    );
    expect(message?.text).toBe('oi');
  });

  it('descarta mensagem própria via key.fromMe', () => {
    expect(
      normalizeProviderMessage(baileys({ conversation: 'eu mesmo' }, {
        key: { remoteJid: '55@s.whatsapp.net', fromMe: true, id: 'X' },
      }), 0),
    ).toBeUndefined();
  });

  it('descarta grupo pelo sufixo do jid', () => {
    expect(
      normalizeProviderMessage(baileys({ conversation: 'grupo' }, {
        key: { remoteJid: '123456@g.us', fromMe: false, id: 'X' },
      }), 0),
    ).toBeUndefined();
  });

  it('extrai botões do buttonsMessage', () => {
    const message = normalizeProviderMessage(
      baileys({
        buttonsMessage: {
          contentText: 'Escolha:',
          buttons: [
            { buttonId: 'h1', buttonText: { displayText: '09:00' } },
            { buttonId: 'h2', buttonText: { displayText: '14:00' } },
          ],
        },
      }),
      0,
    );

    expect(message?.text).toBe('Escolha:');
    expect(message?.options).toEqual([
      { id: 'h1', title: '09:00' },
      { id: 'h2', title: '14:00' },
    ]);
  });

  it('extrai linhas de listMessage', () => {
    const message = normalizeProviderMessage(
      baileys({
        listMessage: {
          description: 'Horários',
          sections: [{ rows: [{ rowId: 'h1', title: '09:00', description: 'manhã' }] }],
        },
      }),
      0,
    );

    expect(message?.options).toEqual([{ id: 'h1', title: '09:00', description: 'manhã' }]);
  });

  it('usa legenda de imagem', () => {
    const message = normalizeProviderMessage(
      baileys({ imageMessage: { caption: 'segue o comprovante' } }),
      0,
    );
    expect(message?.text).toBe('segue o comprovante');
  });

  it('descarta mídia sem legenda', () => {
    expect(normalizeProviderMessage(baileys({ audioMessage: { seconds: 3 } }), 0)).toBeUndefined();
  });
});

describe('extractTimestamp', () => {
  it('converte segundos para milissegundos', () => {
    expect(extractTimestamp({ messageTimestamp: 1_780_000_000 })).toBe(1_780_000_000_000);
  });

  it('mantém milissegundos', () => {
    expect(extractTimestamp({ momment: 1_780_000_000_000 })).toBe(1_780_000_000_000);
  });

  it('aceita string numérica', () => {
    expect(extractTimestamp({ messageTimestamp: '1780000000' })).toBe(1_780_000_000_000);
  });

  it('aceita Long serializado do Baileys', () => {
    expect(extractTimestamp({ messageTimestamp: { low: 1_780_000_000, high: 0 } })).toBe(
      1_780_000_000_000,
    );
  });
});

describe('providerMessageId', () => {
  it('aceita as grafias conhecidas', () => {
    expect(providerMessageId({ messageId: 'A' })).toBe('A');
    expect(providerMessageId({ zaapId: 'C' })).toBe('C');
    expect(providerMessageId({ key: { id: 'D' } })).toBe('D');
    expect(providerMessageId({ data: { key: { id: 'E' } } })).toBe('E');
    expect(providerMessageId({})).toBeUndefined();
  });
});

describe('extractMessageList', () => {
  it('aceita array cru', () => {
    expect(extractMessageList([{ a: 1 }])).toEqual([{ a: 1 }]);
  });

  it('aceita envelope do Evolution (messages.records)', () => {
    expect(extractMessageList({ messages: { records: [{ a: 1 }] } })).toEqual([{ a: 1 }]);
  });

  it('aceita envelopes simples', () => {
    expect(extractMessageList({ messages: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(extractMessageList({ data: [{ b: 2 }] })).toEqual([{ b: 2 }]);
  });

  it('devolve lista vazia para shape desconhecido', () => {
    expect(extractMessageList({ foo: 'bar' })).toEqual([]);
    expect(extractMessageList(null)).toEqual([]);
  });
});
