import type { OutboundMessage, OutboundOption } from './whatsapp.types';

/**
 * Normaliza mensagem dos provedores não-oficiais (Z-API, Evolution, Uazapi).
 *
 * São dois formatos no mundo real:
 *
 * 1. **Plano** (Z-API): `{ phone, fromMe, text: { message } }`
 * 2. **Baileys** (Evolution, Uazapi e derivados): `{ key: { remoteJid, fromMe },
 *    message: { conversation | extendedTextMessage… }, messageTimestamp }`
 *
 * A tolerância a variações de nome é deliberada: o shape muda entre webhook e
 * endpoint de leitura, e entre versões do mesmo provedor. Divergência nova se
 * corrige aqui, num lugar só.
 */
export function normalizeProviderMessage(
  raw: unknown,
  receivedAt: number,
): OutboundMessage | undefined {
  // Envelope de webhook: o que interessa costuma estar em `data`.
  const outer = asRecord(raw);
  const message = asRecord(outer.data)?.key !== undefined ? asRecord(outer.data) : outer;

  const key = asRecord(message.key);
  const fromMe = message.fromMe === true || key.fromMe === true;
  if (fromMe) return undefined;

  const remoteJid = firstString(key, ['remoteJid']) ?? '';
  if (message.isGroup === true || remoteJid.endsWith('@g.us')) return undefined;
  if (message.isStatusReply === true || remoteJid.startsWith('status@')) return undefined;

  const to =
    firstString(message, ['phone', 'chatId']) ?? stripJidSuffix(remoteJid) ?? '';

  const content = asRecord(message.message);
  const options = [...extractFlatOptions(message), ...extractBaileysOptions(content)];
  const text = extractFlatText(message) ?? extractBaileysText(content);

  if (text === undefined && options.length === 0) return undefined;

  const providerTimestamp = extractTimestamp(message);

  return {
    kind: options.length > 0 ? 'interactive' : 'text',
    text: text ?? '',
    options,
    to,
    // Hora de observação, não a do provedor: `messageTimestamp` do Baileys vem
    // em segundos e produziria latência negativa.
    receivedAt,
    ...(providerTimestamp === undefined ? {} : { providerTimestamp }),
    raw: message,
  };
}

/** Identificador estável para não reprocessar a mesma mensagem no polling. */
export function providerMessageId(raw: unknown): string | undefined {
  const outer = asRecord(raw);
  const message = asRecord(outer.data)?.key !== undefined ? asRecord(outer.data) : outer;
  return (
    firstString(message, ['messageId', 'id', 'zaapId']) ??
    firstString(asRecord(message.key), ['id'])
  );
}

/** Epoch em ms. Cada provedor usa um nome e uma unidade. */
export function extractTimestamp(message: Record<string, unknown>): number | undefined {
  for (const key of ['momment', 'moment', 'messageTimestamp', 'timestamp']) {
    const value = message[key];
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : // Baileys às vezes serializa Long como { low, high }
            typeof asRecord(value).low === 'number'
            ? (asRecord(value).low as number)
            : Number.NaN;

    if (Number.isFinite(numeric)) {
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }
  }
  return undefined;
}

function extractFlatText(message: Record<string, unknown>): string | undefined {
  const nested = firstString(asRecord(message.text), ['message', 'body', 'text']);
  if (nested) return nested;

  const direct = firstString(message, ['body', 'caption']);
  if (direct) return direct;

  // `message` só é texto no shape plano; no Baileys é o objeto de conteúdo.
  if (typeof message.message === 'string' && message.message.trim() !== '') {
    return message.message;
  }

  const buttonReply = firstString(asRecord(message.buttonsResponseMessage), [
    'message',
    'buttonText',
  ]);
  if (buttonReply) return buttonReply;

  const listReply = firstString(asRecord(message.listResponseMessage), ['title', 'message']);
  if (listReply) return listReply;

  const image = firstString(asRecord(message.image), ['caption']);
  if (image) return image;

  const buttonsText = firstString(asRecord(message.buttonsMessage), ['message', 'text']);
  if (buttonsText) return buttonsText;

  const listText =
    firstString(asRecord(message.listMessage), ['description', 'title']) ??
    firstString(asRecord(asRecord(message.listMessage).list), ['description']);
  if (listText) return listText;

  return undefined;
}

function extractBaileysText(content: Record<string, unknown>): string | undefined {
  const direct = firstString(content, ['conversation']);
  if (direct) return direct;

  const extended = firstString(asRecord(content.extendedTextMessage), ['text']);
  if (extended) return extended;

  const buttons = firstString(asRecord(content.buttonsMessage), ['contentText', 'text']);
  if (buttons) return buttons;

  const list = firstString(asRecord(content.listMessage), ['description', 'title']);
  if (list) return list;

  const template = firstString(
    asRecord(asRecord(content.templateMessage).hydratedTemplate),
    ['hydratedContentText'],
  );
  if (template) return template;

  const interactive = firstString(
    asRecord(asRecord(content.interactiveMessage).body),
    ['text'],
  );
  if (interactive) return interactive;

  const buttonReply = firstString(asRecord(content.buttonsResponseMessage), [
    'selectedDisplayText',
  ]);
  if (buttonReply) return buttonReply;

  const listReply = firstString(asRecord(content.listResponseMessage), ['title']);
  if (listReply) return listReply;

  for (const key of ['imageMessage', 'videoMessage', 'documentMessage']) {
    const caption = firstString(asRecord(content[key]), ['caption']);
    if (caption) return caption;
  }

  return undefined;
}

function extractFlatOptions(message: Record<string, unknown>): OutboundOption[] {
  const options: OutboundOption[] = [];

  for (const entry of asArray(asRecord(message.buttonsMessage).buttons)) {
    const button = asRecord(entry);
    const label = firstString(button, ['label', 'title', 'buttonText']);
    if (label) options.push({ id: String(button.id ?? label), title: label });
  }

  const listMessage = asRecord(message.listMessage);
  for (const section of asArray(listMessage.sections ?? asRecord(listMessage.list).sections)) {
    for (const row of asArray(asRecord(section).rows)) {
      const item = asRecord(row);
      const label = firstString(item, ['title', 'label']);
      if (!label) continue;
      const description = firstString(item, ['description']);
      options.push({
        id: String(item.rowId ?? item.id ?? label),
        title: label,
        ...(description ? { description } : {}),
      });
    }
  }

  return options;
}

function extractBaileysOptions(content: Record<string, unknown>): OutboundOption[] {
  const options: OutboundOption[] = [];

  for (const entry of asArray(asRecord(content.buttonsMessage).buttons)) {
    const button = asRecord(entry);
    const label = firstString(asRecord(button.buttonText), ['displayText']);
    if (label) options.push({ id: String(button.buttonId ?? label), title: label });
  }

  for (const section of asArray(asRecord(content.listMessage).sections)) {
    for (const row of asArray(asRecord(section).rows)) {
      const item = asRecord(row);
      const label = firstString(item, ['title']);
      if (!label) continue;
      const description = firstString(item, ['description']);
      options.push({
        id: String(item.rowId ?? label),
        title: label,
        ...(description ? { description } : {}),
      });
    }
  }

  return options;
}

/** Cada provedor embrulha a lista de mensagens de um jeito. */
export function extractMessageList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;

  const record = asRecord(payload);

  // Evolution v2: { messages: { records: [...] } }
  const records = asRecord(record.messages).records;
  if (Array.isArray(records)) return records;

  for (const key of ['messages', 'data', 'chats', 'result', 'items']) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

function stripJidSuffix(jid: string): string | undefined {
  if (!jid) return undefined;
  const at = jid.indexOf('@');
  return at === -1 ? jid : jid.slice(0, at);
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
