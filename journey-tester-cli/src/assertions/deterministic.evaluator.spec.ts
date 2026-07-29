import {
  evaluateContains,
  evaluateMatches,
  evaluateMaxLatency,
  evaluateMessageCount,
  evaluateNotContains,
  flattenTurn,
  type TurnSnapshot,
} from './deterministic.evaluator';
import type { OutboundMessage } from '../shared/whatsapp.types';

function message(text: string, options: OutboundMessage['options'] = []): OutboundMessage {
  return {
    kind: options.length > 0 ? 'interactive' : 'text',
    text,
    options,
    to: '5511999999999',
    receivedAt: 0,
    raw: {},
  };
}

function turn(messages: OutboundMessage[], latencyMs = 100): TurnSnapshot {
  return { messages, latencyMs };
}

describe('flattenTurn', () => {
  it('junta várias mensagens do mesmo turno', () => {
    const text = flattenTurn([message('Olá!'), message('Como posso ajudar?')]);
    expect(text).toBe('Olá!\nComo posso ajudar?');
  });

  it('inclui os títulos das opções oferecidas', () => {
    const text = flattenTurn([
      message('Escolha um horário', [
        { id: 'h1', title: '09:00' },
        { id: 'h2', title: '14:00' },
      ]),
    ]);
    expect(text).toContain('[opções: 09:00 | 14:00]');
  });
});

describe('evaluateContains', () => {
  it('ignora acento e caixa', () => {
    const result = evaluateContains('horários disponíveis', turn([message('HORARIOS DISPONIVEIS')]));
    expect(result.passed).toBe(true);
  });

  it('falha quando o texto não aparece', () => {
    const result = evaluateContains('protocolo', turn([message('Bom dia!')]));
    expect(result.passed).toBe(false);
    expect(result.actual).toBe('Bom dia!');
  });

  it('encontra o texto dentro das opções de botão', () => {
    const result = evaluateContains(
      'falar com atendente',
      turn([message('Posso ajudar?', [{ id: 'x', title: 'Falar com atendente' }])]),
    );
    expect(result.passed).toBe(true);
  });

  it('reporta ausência de resposta em vez de string vazia', () => {
    expect(evaluateContains('oi', turn([])).actual).toBe('(sem resposta)');
  });
});

describe('evaluateNotContains', () => {
  it('passa quando o termo proibido não aparece', () => {
    expect(evaluateNotContains('desconto', turn([message('Segue o valor')])).passed).toBe(true);
  });

  it('falha quando o termo proibido aparece com acento diferente', () => {
    expect(evaluateNotContains('reembolso', turn([message('fazemos REEMBÔLSO')])).passed).toBe(
      false,
    );
  });
});

describe('evaluateMatches', () => {
  it('aplica a regex sem diferenciar caixa', () => {
    const result = evaluateMatches('protocolo \\d{4,}', turn([message('Protocolo 12345 aberto')]));
    expect(result.passed).toBe(true);
  });

  it('não estoura com regex inválida', () => {
    const result = evaluateMatches('[a-', turn([message('qualquer coisa')]));
    expect(result.passed).toBe(false);
    expect(result.actual).toContain('regex inválida');
  });
});

describe('evaluateMaxLatency', () => {
  it('passa no limite exato', () => {
    expect(evaluateMaxLatency(5000, turn([message('ok')], 5000)).passed).toBe(true);
  });

  it('falha acima do limite', () => {
    expect(evaluateMaxLatency(5000, turn([message('ok')], 5001)).passed).toBe(false);
  });
});

describe('evaluateMessageCount', () => {
  it('respeita apenas o max quando min não é informado', () => {
    const result = evaluateMessageCount({ max: 2 }, turn([message('a'), message('b')]));
    expect(result.passed).toBe(true);
  });

  it('falha quando passa do max', () => {
    const result = evaluateMessageCount(
      { max: 2 },
      turn([message('a'), message('b'), message('c')]),
    );
    expect(result.passed).toBe(false);
    expect(result.actual).toBe('3');
  });

  it('falha quando fica abaixo do min', () => {
    expect(evaluateMessageCount({ min: 2 }, turn([message('a')])).passed).toBe(false);
  });
});
