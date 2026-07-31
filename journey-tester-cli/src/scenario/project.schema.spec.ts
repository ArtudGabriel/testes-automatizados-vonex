import { projectSchema, renderKnownData, renderProjectBriefing } from './project.schema';

const minimal = { name: 'Clínica X', description: 'Atendimento ao paciente' };

describe('projectSchema', () => {
  it('exige name e description', () => {
    expect(projectSchema.safeParse({ name: 'X' }).success).toBe(false);
    expect(projectSchema.safeParse(minimal).success).toBe(true);
  });

  it('aplica defaults nas listas', () => {
    const result = projectSchema.parse(minimal);
    expect(result.capabilities).toEqual([]);
    expect(result.outOfScope).toEqual([]);
    expect(result.knownData).toEqual({});
    expect(result.glossary).toEqual([]);
  });

  it('recusa chave desconhecida em vez de ignorar em silêncio', () => {
    const result = projectSchema.safeParse({ ...minimal, capabilites: ['typo'] });
    expect(result.success).toBe(false);
  });
});

describe('renderProjectBriefing', () => {
  it('inclui escopo e fora de escopo', () => {
    const project = projectSchema.parse({
      ...minimal,
      segment: 'odontologia',
      capabilities: ['agendar consulta'],
      outOfScope: ['dar diagnóstico'],
      escalation: 'transferir quando pedirem',
    });

    const text = renderProjectBriefing(project);
    expect(text).toContain('Clínica X');
    expect(text).toContain('odontologia');
    expect(text).toContain('- agendar consulta');
    expect(text).toContain('- dar diagnóstico');
    expect(text).toContain('transferir quando pedirem');
  });

  it('omite seções vazias', () => {
    const text = renderProjectBriefing(projectSchema.parse(minimal));
    expect(text).not.toContain('fora do escopo');
    expect(text).not.toContain('Termos do negócio');
  });
});

describe('renderKnownData', () => {
  it('lista os dados que o cliente simulado possui', () => {
    const project = projectSchema.parse({
      ...minimal,
      knownData: { CPF: '123.456.789-00', convênio: 'Amil' },
    });

    const text = renderKnownData(project);
    expect(text).toContain('- CPF: 123.456.789-00');
    expect(text).toContain('- convênio: Amil');
  });

  it('devolve string vazia quando não há dados', () => {
    expect(renderKnownData(projectSchema.parse(minimal))).toBe('');
  });
});
