import {
  buildInboundWebhook,
  extractInboundMessages,
  parseOutboundPayload,
} from './whatsapp.types';

describe('parseOutboundPayload', () => {
  it('lê mensagem de texto', () => {
    const message = parseOutboundPayload(
      {
        messaging_product: 'whatsapp',
        to: '5511999999999',
        type: 'text',
        text: { preview_url: false, body: 'Olá, tudo bem?' },
      },
      1000,
    );

    expect(message.kind).toBe('text');
    expect(message.text).toBe('Olá, tudo bem?');
    expect(message.to).toBe('5511999999999');
    expect(message.receivedAt).toBe(1000);
  });

  it('extrai botões de mensagem interativa', () => {
    const message = parseOutboundPayload(
      {
        to: '5511999999999',
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: 'Escolha:' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'sim', title: 'Sim' } },
              { type: 'reply', reply: { id: 'nao', title: 'Não' } },
            ],
          },
        },
      },
      0,
    );

    expect(message.kind).toBe('interactive');
    expect(message.text).toBe('Escolha:');
    expect(message.options).toEqual([
      { id: 'sim', title: 'Sim' },
      { id: 'nao', title: 'Não' },
    ]);
  });

  it('extrai linhas de mensagem de lista', () => {
    const message = parseOutboundPayload(
      {
        to: '1',
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: 'Horários' },
          action: {
            button: 'Ver',
            sections: [
              { rows: [{ id: 'h1', title: '09:00', description: 'manhã' }] },
            ],
          },
        },
      },
      0,
    );

    expect(message.options).toEqual([{ id: 'h1', title: '09:00', description: 'manhã' }]);
  });

  it('identifica template pelo nome', () => {
    const message = parseOutboundPayload(
      { to: '1', type: 'template', template: { name: 'boas_vindas', language: { code: 'pt_BR' } } },
      0,
    );
    expect(message.kind).toBe('template');
    expect(message.text).toBe('[template:boas_vindas]');
  });

  it('usa a legenda em mensagem de mídia', () => {
    const message = parseOutboundPayload(
      { to: '1', type: 'image', image: { link: 'https://x/y.png', caption: 'sua nota' } },
      0,
    );
    expect(message.kind).toBe('media');
    expect(message.text).toBe('sua nota');
  });
});

describe('buildInboundWebhook', () => {
  const base = {
    contact: { phone: '5511999999999', name: 'Maria' },
    phoneNumberId: '111',
    businessAccountId: '222',
    displayPhoneNumber: '5511900000000',
  };

  it('monta payload de texto no formato da Meta', () => {
    const payload = buildInboundWebhook({ ...base, text: 'quero agendar' });
    const messages = extractInboundMessages(payload, 42);

    expect(payload.object).toBe('whatsapp_business_account');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe('quero agendar');
    expect(messages[0]?.to).toBe('5511999999999');
  });

  it('monta payload de clique em botão', () => {
    const payload = buildInboundWebhook({ ...base, optionId: 'sim', optionTitle: 'Sim' });
    const messages = extractInboundMessages(payload, 0);

    expect(messages[0]?.kind).toBe('interactive');
    expect(messages[0]?.text).toBe('Sim');
  });
});
