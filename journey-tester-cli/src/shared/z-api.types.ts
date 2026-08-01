import type { OutboundMessage, OutboundOption } from './whatsapp.types';

/**
 * Normaliza a mensagem da Z-API para o formato do runner.
 *
 * A tolerância aqui é deliberada: a Z-API tem variações de shape entre o
 * webhook e o endpoint de chat, e entre versões. Em vez de quebrar quando um
 * nome de campo diverge, tentamos os candidatos conhecidos. Se a sua instância
 * devolver algo diferente, este é o único arquivo a ajustar.
 */
export function normalizeZApiMessage(
  raw: unknown,
  receivedAt: number,
): OutboundMessage | undefined {
  const message = asRecord(raw);

  // Mensagem enviada por nós mesmos não é resposta da jornada.
  if (message.fromMe === true) return undefined;
  // Conversa de teste é sempre 1:1.
  if (message.isGroup === true) return undefined;
  // Status/stories não são resposta.
  if (message.isStatusReply === true) return undefined;

  const to = firstString(message, ['phone', 'connectedPhone', 'chatId']) ?? '';
  const options = extractOptions(message);
  const text = extractText(message);

  if (text === undefined && options.length === 0) return undefined;

  return {
    kind: options.length > 0 ? 'interactive' : 'text',
    text: text ?? '',
    options,
    to,
    receivedAt: extractTimestamp(message) ?? receivedAt,
    raw: message,
  };
}

/** Identificador estável para não reprocessar a mesma mensagem no polling. */
export function zApiMessageId(raw: unknown): string | undefined {
  const message = asRecord(raw);
  return firstString(message, ['messageId', 'id', 'zaapId']);
}

/** Epoch em ms. A Z-API usa `momment`; aceitamos as grafias vizinhas. */
export function extractTimestamp(message: Record<string, unknown>): number | undefined {
  for (const key of ['momment', 'moment', 'messageTimestamp', 'timestamp']) {
    const value = message[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Alguns campos vêm em segundos, outros em milissegundos.
      return value < 1e12 ? value * 1000 : value;
    }
  }
  return undefined;
}

function extractText(message: Record<string, unknown>): string | undefined {
  // Texto simples: `text.message` no webhook, `text` cru em algumas respostas.
  const nested = firstString(asRecord(message.text), ['message', 'body', 'text']);
  if (nested) return nested;

  const direct = firstString(message, ['body', 'message', 'caption']);
  if (direct) return direct;

  // Resposta de botão ou lista escolhida pelo cliente não interessa aqui, mas
  // a jornada também usa esses tipos para *oferecer* opções.
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

function extractOptions(message: Record<string, unknown>): OutboundOption[] {
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

/** A Z-API devolve ora um array cru, ora um envelope com a lista dentro. */
export function extractMessageList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;

  const record = asRecord(payload);
  for (const key of ['messages', 'data', 'chats', 'result']) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }

  return [];
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
