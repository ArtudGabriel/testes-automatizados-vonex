import { createServer, type Server } from 'node:http';
import axios, { type AxiosInstance } from 'axios';
import { readBody } from '../capture/graph-sink.server';
import type { AppConfig } from '../config/env.config';
import { logger } from '../shared/logger';
import {
  extractMessageList,
  normalizeZApiMessage,
  zApiMessageId,
} from '../shared/z-api.types';
import type {
  ChannelAdapter,
  ConversationContext,
  TurnReply,
  WaitOptions,
} from './channel.adapter';
import { MessageCollector } from './message-collector';

/**
 * Automatiza um número comum (chip de teste) via Z-API, conversando com o
 * número oficial do bot.
 *
 * É o caminho quando não dá para reconfigurar a plataforma: a jornada receptiva
 * recebe exatamente o que receberia de um cliente real — sem template, sem
 * janela de 24h, sem business falando com business.
 *
 * Em troca: API não-oficial (sessão cai, precisa reconectar QR) e uso fora dos
 * termos do WhatsApp, com risco de banimento do número conectado. Use chip
 * dedicado, nunca o número de trabalho.
 */
export class ZApiChannelAdapter implements ChannelAdapter {
  readonly name = 'z-api';

  private readonly collector = new MessageCollector();
  private readonly http: AxiosInstance;
  private readonly botPhone: string;
  private readonly seenMessageIds = new Set<string>();
  private watermark = 0;
  private pollTimer?: NodeJS.Timeout;
  private polling = false;
  private server?: Server;

  constructor(private readonly config: AppConfig) {
    const { Z_API_INSTANCE, Z_API_TOKEN, BOT_PHONE_NUMBER } = config;

    if (!Z_API_INSTANCE || !Z_API_TOKEN || !BOT_PHONE_NUMBER) {
      throw new Error(
        'adapter z-api exige Z_API_INSTANCE, Z_API_TOKEN e BOT_PHONE_NUMBER (número do bot)',
      );
    }

    this.botPhone = BOT_PHONE_NUMBER;
    this.http = axios.create({
      baseURL: `${config.Z_API_BASE_URL}/instances/${Z_API_INSTANCE}/token/${Z_API_TOKEN}`,
      headers: config.Z_API_CLIENT_TOKEN
        ? { 'client-token': config.Z_API_CLIENT_TOKEN }
        : undefined,
      timeout: 20_000,
      validateStatus: () => true,
    });
  }

  async open(_context: ConversationContext): Promise<void> {
    this.collector.reset();
    this.seenMessageIds.clear();

    // Só interessa o que chegar a partir de agora — o chat já tem histórico.
    this.watermark = Date.now();

    if (this.config.Z_API_CAPTURE === 'webhook') {
      await this.startWebhookServer();
      return;
    }

    await this.primePollWatermark();
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.config.Z_API_POLL_MS);
  }

  async sendText(text: string): Promise<void> {
    const response = await this.http.post('/send-text', {
      phone: this.botPhone,
      message: text,
    });

    if (response.status >= 400) {
      throw new Error(
        `Z-API respondeu ${response.status} ao enviar: ${JSON.stringify(response.data)}`,
      );
    }
    logger.debug('mensagem enviada pela Z-API', { status: response.status });
  }

  async sendOptionReply(optionId: string, optionTitle?: string): Promise<void> {
    // Clicar num botão via API não-oficial é instável; responder com o texto
    // do botão é o que um cliente real faria e a jornada trata igual.
    await this.sendText(optionTitle ?? optionId);
  }

  waitForReply(options: WaitOptions): Promise<TurnReply> {
    return this.collector.wait(options);
  }

  async close(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  /** Marca o histórico existente como visto, para não reprocessá-lo. */
  private async primePollWatermark(): Promise<void> {
    const messages = await this.fetchChatMessages();
    for (const raw of messages) {
      const id = zApiMessageId(raw);
      if (id) this.seenMessageIds.add(id);
    }
    logger.debug('histórico do chat marcado como visto', { total: messages.length });
  }

  private async poll(): Promise<void> {
    if (this.polling) return; // evita sobreposição em chat grande
    this.polling = true;

    try {
      const messages = await this.fetchChatMessages();

      for (const raw of messages) {
        const id = zApiMessageId(raw);
        if (id && this.seenMessageIds.has(id)) continue;

        const message = normalizeZApiMessage(raw, Date.now());
        if (id) this.seenMessageIds.add(id);

        // Sem id confiável, o watermark de tempo evita duplicata.
        if (!message || (!id && message.receivedAt <= this.watermark)) continue;

        this.watermark = Math.max(this.watermark, message.receivedAt);
        this.collector.push(message);
      }
    } catch (error) {
      logger.warn('falha ao consultar mensagens na Z-API', {
        error: (error as Error).message,
      });
    } finally {
      this.polling = false;
    }
  }

  private async fetchChatMessages(): Promise<unknown[]> {
    const response = await this.http.get(`/chat-messages/${this.botPhone}`, {
      params: { amount: this.config.Z_API_POLL_AMOUNT },
    });

    if (response.status >= 400) {
      throw new Error(
        `Z-API respondeu ${response.status} ao ler o chat: ${JSON.stringify(response.data)}`,
      );
    }

    return extractMessageList(response.data);
  }

  private async startWebhookServer(): Promise<void> {
    if (this.server) return;

    this.server = createServer((req, res) => {
      void (async () => {
        try {
          const payload = JSON.parse(await readBody(req)) as unknown;
          for (const raw of extractMessageList(payload).concat(payload)) {
            const message = normalizeZApiMessage(raw, Date.now());
            if (message) this.collector.push(message);
          }
        } catch (error) {
          logger.warn('webhook da Z-API com corpo inválido', {
            error: (error as Error).message,
          });
        }
        res.writeHead(200).end();
      })();
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error('servidor de webhook da Z-API não foi criado'));
        return;
      }
      server.once('error', reject);
      server.listen(this.config.INBOUND_WEBHOOK_PORT, this.config.INBOUND_WEBHOOK_HOST, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    logger.info(
      `webhook da Z-API escutando em ${this.config.INBOUND_WEBHOOK_HOST}:${this.config.INBOUND_WEBHOOK_PORT} ` +
        '(precisa estar exposto publicamente e cadastrado como "Ao receber" na Z-API)',
    );
  }
}
