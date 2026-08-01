import { randomUUID } from 'node:crypto';

export type OutboundMessageKind =
  | 'text'
  | 'interactive'
  | 'template'
  | 'media'
  | 'unknown';

/** Uma opção clicável (botão ou item de lista) oferecida pela IA. */
export interface OutboundOption {
  id: string;
  title: string;
  description?: string;
}

/** Mensagem que a plataforma tentou enviar ao cliente, já normalizada. */
export interface OutboundMessage {
  kind: OutboundMessageKind;
  text: string;
  options: OutboundOption[];
  to: string;
  /**
   * Quando o runner **observou** a mensagem. É o que mede latência — nunca use
   * o relógio do provedor aqui: ele vem em segundos em alguns provedores, o que
   * produz latência negativa e faria `maxLatencyMs` passar falsamente.
   */
  receivedAt: number;
  /** Relógio do provedor, quando existe. Serve para ordenar e deduplicar. */
  providerTimestamp?: number;
  raw: unknown;
}

export interface InboundContact {
  phone: string;
  name: string;
}

/**
 * Converte o payload de envio da Cloud API (o que a plataforma manda para o
 * graph.facebook.com) em algo que o runner consegue asseverar.
 */
export function parseOutboundPayload(
  payload: Record<string, unknown>,
  receivedAt: number,
): OutboundMessage {
  const to = typeof payload.to === 'string' ? payload.to : '';
  const type = typeof payload.type === 'string' ? payload.type : 'text';
  const base = { to, receivedAt, raw: payload };

  if (type === 'text') {
    const text = readPath(payload, ['text', 'body']) ?? '';
    return { ...base, kind: 'text', text, options: [] };
  }

  if (type === 'interactive') {
    const interactive = asRecord(payload.interactive);
    const text =
      readPath(interactive, ['body', 'text']) ??
      readPath(interactive, ['header', 'text']) ??
      '';
    return {
      ...base,
      kind: 'interactive',
      text,
      options: parseInteractiveOptions(interactive),
    };
  }

  if (type === 'template') {
    const template = asRecord(payload.template);
    const name = typeof template.name === 'string' ? template.name : 'unknown';
    return { ...base, kind: 'template', text: `[template:${name}]`, options: [] };
  }

  const media = asRecord(payload[type]);
  const caption = typeof media.caption === 'string' ? media.caption : '';
  if (Object.keys(media).length > 0) {
    return { ...base, kind: 'media', text: caption || `[${type}]`, options: [] };
  }

  return { ...base, kind: 'unknown', text: JSON.stringify(payload), options: [] };
}

function parseInteractiveOptions(interactive: Record<string, unknown>): OutboundOption[] {
  const action = asRecord(interactive.action);
  const options: OutboundOption[] = [];

  for (const button of asArray(action.buttons)) {
    const reply = asRecord(asRecord(button).reply);
    if (typeof reply.title === 'string') {
      options.push({ id: String(reply.id ?? reply.title), title: reply.title });
    }
  }

  for (const section of asArray(action.sections)) {
    for (const row of asArray(asRecord(section).rows)) {
      const item = asRecord(row);
      if (typeof item.title === 'string') {
        options.push({
          id: String(item.id ?? item.title),
          title: item.title,
          ...(typeof item.description === 'string'
            ? { description: item.description }
            : {}),
        });
      }
    }
  }

  return options;
}

export interface InboundWebhookParams {
  contact: InboundContact;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string;
  text?: string;
  optionId?: string;
  optionTitle?: string;
}

/**
 * Monta o payload de webhook que a Meta entregaria à plataforma quando o
 * cliente manda uma mensagem. É por aqui que o adapter `http` injeta o turno.
 */
export function buildInboundWebhook(params: InboundWebhookParams): Record<string, unknown> {
  const message =
    params.optionId !== undefined
      ? {
          type: 'interactive',
          interactive: {
            type: 'button_reply',
            button_reply: {
              id: params.optionId,
              title: params.optionTitle ?? params.optionId,
            },
          },
        }
      : { type: 'text', text: { body: params.text ?? '' } };

  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: params.businessAccountId,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: params.displayPhoneNumber,
                phone_number_id: params.phoneNumberId,
              },
              contacts: [
                {
                  profile: { name: params.contact.name },
                  wa_id: params.contact.phone,
                },
              ],
              messages: [
                {
                  from: params.contact.phone,
                  id: `wamid.TEST-${randomUUID()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** Extrai as mensagens de um webhook recebido (adapter cloud-api). */
export function extractInboundMessages(
  payload: Record<string, unknown>,
  receivedAt: number,
): OutboundMessage[] {
  const messages: OutboundMessage[] = [];

  for (const entry of asArray(payload.entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const value = asRecord(asRecord(change).value);
      for (const raw of asArray(value.messages)) {
        const message = asRecord(raw);
        const type = typeof message.type === 'string' ? message.type : 'unknown';
        const from = typeof message.from === 'string' ? message.from : '';

        if (type === 'text') {
          messages.push({
            kind: 'text',
            text: readPath(message, ['text', 'body']) ?? '',
            options: [],
            to: from,
            receivedAt,
            raw: message,
          });
          continue;
        }

        if (type === 'interactive') {
          const interactive = asRecord(message.interactive);
          messages.push({
            kind: 'interactive',
            text:
              readPath(interactive, ['button_reply', 'title']) ??
              readPath(interactive, ['list_reply', 'title']) ??
              '',
            options: [],
            to: from,
            receivedAt,
            raw: message,
          });
          continue;
        }

        messages.push({
          kind: 'unknown',
          text: `[${type}]`,
          options: [],
          to: from,
          receivedAt,
          raw: message,
        });
      }
    }
  }

  return messages;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readPath(source: unknown, path: string[]): string | undefined {
  let current: unknown = source;
  for (const key of path) {
    current = asRecord(current)[key];
  }
  return typeof current === 'string' ? current : undefined;
}
