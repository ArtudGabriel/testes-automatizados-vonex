import { projectSchema } from '../scenario/project.schema';
import { personaSchema } from '../scenario/scenario.schema';
import { buildSystemPrompt, describePersona } from './persona.simulator';

const project = projectSchema.parse({
  name: 'Clínica OdontoVida',
  segment: 'odontologia',
  description: 'Agendamento e dúvidas de pacientes',
  capabilities: ['agendar consulta'],
  outOfScope: ['dar diagnóstico'],
  knownData: { CPF: '123.456.789-00' },
});

function persona(input: Record<string, unknown>) {
  return personaSchema.parse({ goal: 'remarcar a consulta', ...input });
}

describe('buildSystemPrompt', () => {
  it('injeta o briefing do projeto', () => {
    const prompt = buildSystemPrompt({
      persona: persona({ archetype: 'ideal' }),
      project,
      transcript: '',
    });

    expect(prompt).toContain('Clínica OdontoVida');
    expect(prompt).toContain('- agendar consulta');
    expect(prompt).toContain('- dar diagnóstico');
  });

  it('injeta os dados do cliente para ele não inventar CPF', () => {
    const prompt = buildSystemPrompt({
      persona: persona({ archetype: 'ideal' }),
      project,
      transcript: '',
    });

    expect(prompt).toContain('<seus_dados>');
    expect(prompt).toContain('123.456.789-00');
  });

  it('injeta comportamento e táticas do arquétipo', () => {
    const prompt = buildSystemPrompt({
      persona: persona({ archetype: 'angry' }),
      project,
      transcript: '',
    });

    expect(prompt).toContain('Cliente bravo');
    expect(prompt).toContain('Procon');
  });

  it('arquétipos diferentes geram prompts diferentes', () => {
    const angry = buildSystemPrompt({
      persona: persona({ archetype: 'angry' }),
      project,
      transcript: '',
    });
    const ideal = buildSystemPrompt({
      persona: persona({ archetype: 'ideal' }),
      project,
      transcript: '',
    });

    expect(angry).not.toBe(ideal);
  });

  it('soma description ao arquétipo em vez de substituir', () => {
    const prompt = buildSystemPrompt({
      persona: persona({ archetype: 'confused', description: 'usa muito áudio' }),
      project,
      transcript: '',
    });

    expect(prompt).toContain('Cliente confuso');
    expect(prompt).toContain('Traços adicionais');
    expect(prompt).toContain('usa muito áudio');
  });

  it('funciona só com description, sem arquétipo', () => {
    const prompt = buildSystemPrompt({
      persona: persona({ description: 'engenheiro que testa limites de sistema' }),
      project,
      transcript: '',
    });

    expect(prompt).toContain('engenheiro que testa limites');
    expect(prompt).not.toContain('Traços adicionais');
  });

  it('sempre inclui o objetivo', () => {
    const prompt = buildSystemPrompt({
      persona: persona({ archetype: 'ideal' }),
      project,
      transcript: '',
    });

    expect(prompt).toContain('<seu_objetivo>');
    expect(prompt).toContain('remarcar a consulta');
  });
});

describe('describePersona', () => {
  it('usa o rótulo do arquétipo', () => {
    expect(describePersona(persona({ archetype: 'wants-human' }))).toBe(
      'Cliente que quer humano',
    );
  });

  it('cai para rótulo genérico em persona livre', () => {
    expect(describePersona(persona({ description: 'qualquer um' }))).toBe(
      'persona customizada',
    );
  });
});
