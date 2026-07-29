import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { logger } from '../shared/logger';
import { parseOutboundPayload, type OutboundMessage } from '../shared/whatsapp.types';

export interface GraphSinkOptions {
  host: string;
  port: number;
}

/**
 * Finge ser o graph.facebook.com. A plataforma responde ao cliente chamando a
 * Cloud API de forma assíncrona — sem interceptar essa chamada o runner nunca
 * veria a resposta da IA.
 *
 * Uso: apontar a base URL da Cloud API do ambiente de teste da plataforma para
 * `http://<host>:<port>` (uma env var, sem mudança de código).
 *
 * Rotas aceitas (as mesmas da Meta):
 *   POST /:version/:phoneNumberId/messages
 *   POST /:phoneNumberId/messages
 */
export class GraphSinkServer {
  private server?: Server;
  private readonly listeners = new Set<(message: OutboundMessage) => void>();

  constructor(private readonly options: GraphSinkOptions) {}

  async start(): Promise<void> {
    if (this.server) return;

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error('servidor do sink não foi criado'));
        return;
      }
      server.once('error', reject);
      server.listen(this.options.port, this.options.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    logger.info(
      `graph sink escutando em http://${this.options.host}:${this.options.port}`,
    );
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  onMessage(listener: (message: OutboundMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    if (req.method !== 'POST' || !url.includes('/messages')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'rota não suportada pelo sink' } }));
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(await readBody(req)) as Record<string, unknown>;
    } catch (error) {
      logger.warn('sink recebeu corpo não-JSON', { error: (error as Error).message });
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'corpo inválido' } }));
      return;
    }

    const message = parseOutboundPayload(payload, Date.now());
    logger.debug('sink capturou mensagem', { kind: message.kind, text: message.text });

    for (const listener of this.listeners) {
      listener(message);
    }

    // Mesma forma de resposta da Cloud API, para a plataforma não quebrar.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        messaging_product: 'whatsapp',
        contacts: [{ input: message.to, wa_id: message.to }],
        messages: [{ id: `wamid.SINK-${randomUUID()}` }],
      }),
    );
  }
}

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}
