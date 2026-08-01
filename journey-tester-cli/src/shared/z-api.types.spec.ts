import {
  extractMessageList,
  extractTimestamp,
  normalizeZApiMessage,
  zApiMessageId,
} from './z-api.types';

describe('normalizeZApiMessage', () => {
  it('lê texto no formato do webhook (text.message)', () => {
    const message = normalizeZApiMessage(
      {
        phone: '5511999999999',
        fromMe: false,
        messageId: 'ABC123',
        momment: 1_780_000_000_000,
        text: { message: 'Olá! Como posso ajudar?' },
      },
      0,
    );

    expect(message?.kind).toBe('text');
    expect(message?.text).toBe('Olá! Como posso ajudar?');
    expect(message?.to).toBe('5511999999999');
    expect(message?.receivedAt).toBe(1_780_000_000_000);
  });

  it('lê texto quando vem em `body`', () => {
    const message = normalizeZApiMessage({ phone: '1', fromMe: false, body: 'oi' }, 0);
    expect(message?.text).toBe('oi');
  });

  it('descarta mensagem enviada por nós', () => {
    expect(
      normalizeZApiMessage({ phone: '1', fromMe: true, text: { message: 'oi' } }, 0),
    ).toBeUndefined();
  });

  it('descarta grupo e status', () => {
    expect(
      normalizeZApiMessage({ fromMe: false, isGroup: true, text: { message: 'x' } }, 0),
    ).toBeUndefined();
    expect(
      normalizeZApiMessage({ fromMe: false, isStatusReply: true, text: { message: 'x' } }, 0),
    ).toBeUndefined();
  });

  it('descarta mensagem sem texto nem opção (áudio, sticker)', () => {
    expect(normalizeZApiMessage({ phone: '1', fromMe: false, audio: {} }, 0)).toBeUndefined();
  });

  it('usa o timestamp de chegada quando a mensagem não traz um', () => {
    const message = normalizeZApiMessage({ phone: '1', fromMe: false, body: 'oi' }, 4242);
    expect(message?.receivedAt).toBe(4242);
  });

  it('extrai botões oferecidos pela jornada', () => {
    const message = normalizeZApiMessage(
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
    expect(message?.text).toBe('Escolha um horário:');
    expect(message?.options).toEqual([
      { id: 'h1', title: '09:00' },
      { id: 'h2', title: '14:00' },
    ]);
  });

  it('extrai linhas de lista, com ou sem envelope `list`', () => {
    const flat = normalizeZApiMessage(
      {
        phone: '1',
        fromMe: false,
        listMessage: {
          description: 'Horários',
          sections: [{ rows: [{ rowId: 'h1', title: '09:00', description: 'manhã' }] }],
        },
      },
      0,
    );
    expect(flat?.options).toEqual([{ id: 'h1', title: '09:00', description: 'manhã' }]);

    const nested = normalizeZApiMessage(
      {
        phone: '1',
        fromMe: false,
        listMessage: {
          list: {
            description: 'Horários',
            sections: [{ rows: [{ rowId: 'h2', title: '14:00' }] }],
          },
        },
      },
      0,
    );
    expect(nested?.options).toEqual([{ id: 'h2', title: '14:00' }]);
  });

  it('usa a legenda de imagem como texto', () => {
    const message = normalizeZApiMessage(
      { phone: '1', fromMe: false, image: { caption: 'segue o comprovante' } },
      0,
    );
    expect(message?.text).toBe('segue o comprovante');
  });
});

describe('extractTimestamp', () => {
  it('converte segundos para milissegundos', () => {
    expect(extractTimestamp({ momment: 1_780_000_000 })).toBe(1_780_000_000_000);
  });

  it('mantém milissegundos', () => {
    expect(extractTimestamp({ momment: 1_780_000_000_000 })).toBe(1_780_000_000_000);
  });

  it('devolve undefined quando não há campo conhecido', () => {
    expect(extractTimestamp({})).toBeUndefined();
  });
});

describe('zApiMessageId', () => {
  it('aceita as grafias conhecidas', () => {
    expect(zApiMessageId({ messageId: 'A' })).toBe('A');
    expect(zApiMessageId({ id: 'B' })).toBe('B');
    expect(zApiMessageId({ zaapId: 'C' })).toBe('C');
    expect(zApiMessageId({})).toBeUndefined();
  });
});

describe('extractMessageList', () => {
  it('aceita array cru', () => {
    expect(extractMessageList([{ a: 1 }])).toEqual([{ a: 1 }]);
  });

  it('aceita envelope com a lista dentro', () => {
    expect(extractMessageList({ messages: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(extractMessageList({ data: [{ b: 2 }] })).toEqual([{ b: 2 }]);
  });

  it('devolve lista vazia para shape desconhecido', () => {
    expect(extractMessageList({ foo: 'bar' })).toEqual([]);
    expect(extractMessageList(null)).toEqual([]);
  });
});
