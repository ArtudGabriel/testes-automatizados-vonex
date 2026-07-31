import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { logger } from '../shared/logger';
import { readBody } from './graph-sink.server';
import type { ApiStubSpec } from '../scenario/api-spy.schema';

/** Cabeçalhos que nunca entram no relatório. */
const REDACTED_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-auth-token',
  'cookie',
  'proxy-authorization',
]);

export interface RecordedApiCall {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  receivedAt: number;
  /** `match` do stub que respondeu, ou undefined se caiu no default. */
  matchedStub?: string;
}

export interface ApiSpyOptions {
  host: string;
  port: number;
  stubs: ApiStubSpec[];
}

/**
 * Finge ser as APIs externas que a jornada consome (CRM, agenda, ERP).
 *
 * Resolve dois problemas de uma vez:
 * 1. Cobertura — sem isto as asserções só enxergam o que a IA escreve no
 *    WhatsApp. Se a jornada chama o endpoint errado mas responde algo
 *    plausível, o teste passa.
 * 2. Determinismo — a jornada passa a receber sempre a mesma resposta, em vez
 *    de depender do estado do banco de teste.
 *
 * Uso: apontar a base URL da API externa, no ambiente de teste da vonex.ai,
 * para `http://<host>:<port>`.
 */
export class ApiSpyServer {
  private server?: Server;
  private readonly calls: RecordedApiCall[] = [];

  constructor(private readonly options: ApiSpyOptions) {}

  async start(): Promise<void> {
    if (this.server) return;

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error('servidor do api spy não foi criado'));
        return;
      }
      server.once('error', reject);
      server.listen(this.options.port, this.options.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    logger.info(`api spy escutando em http://${this.options.host}:${this.options.port}`);
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  /** Quantas chamadas já foram registradas — marca o início de um turno. */
  get callCount(): number {
    return this.calls.length;
  }

  /** Chamadas registradas a partir de um marcador. */
  callsSince(marker: number): RecordedApiCall[] {
    return this.calls.slice(marker);
  }

  allCalls(): RecordedApiCall[] {
    return [...this.calls];
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://api-spy.local');
    const rawBody = await readBody(req);

    const call: RecordedApiCall = {
      method: (req.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: redactHeaders(req.headers),
      body: parseBody(rawBody, req.headers['content-type']),
      receivedAt: Date.now(),
    };

    const stub = this.findStub(call);
    if (stub) {
      call.matchedStub = stub.match;
    } else {
      logger.warn(
        `api spy sem stub para ${call.method} ${call.path} — respondendo 200 {} (adicione um apiStub)`,
      );
    }

    this.calls.push(call);

    if (stub?.respond.delayMs) {
      await delay(stub.respond.delayMs);
    }

    const status = stub?.respond.status ?? 200;
    const body = stub?.respond.body ?? {};
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private findStub(call: RecordedApiCall): ApiStubSpec | undefined {
    // Primeiro que casar vence — deixa o cenário pôr o específico antes do genérico.
    return this.options.stubs.find((stub) => matchesTarget(call, stub.match));
  }
}

/**
 * Casa uma chamada com um alvo no formato `MÉTODO /caminho`, onde o caminho
 * aceita `*` como curinga de um ou mais segmentos.
 */
export function matchesTarget(
  call: Pick<RecordedApiCall, 'method' | 'path'>,
  target: string,
): boolean {
  const trimmed = target.trim();
  const separator = trimmed.indexOf(' ');

  const method = separator === -1 ? 'ANY' : trimmed.slice(0, separator).toUpperCase();
  const pathPattern = separator === -1 ? trimmed : trimmed.slice(separator + 1).trim();

  if (method !== 'ANY' && method !== '*' && method !== call.method) return false;

  return pathToRegExp(pathPattern).test(call.path);
}

function pathToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}/?$`);
}

function parseBody(raw: string, contentType?: string): unknown {
  if (!raw) return undefined;

  if (contentType?.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  if (contentType?.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }

  // Sem content-type confiável: tenta JSON e cai para texto.
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function redactHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const flat = Array.isArray(value) ? value.join(', ') : value;
    result[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? '[redacted]' : flat;
  }
  return result;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
