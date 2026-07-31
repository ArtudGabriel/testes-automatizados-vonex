import { archetypeIds, findArchetype, PERSONA_ARCHETYPES } from './archetypes';

describe('catálogo de arquétipos', () => {
  it('não tem id duplicado', () => {
    const ids = archetypeIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('usa kebab-case nos ids', () => {
    for (const id of archetypeIds()) {
      expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it('todo arquétipo tem comportamento, táticas e critério de sucesso', () => {
    for (const archetype of PERSONA_ARCHETYPES) {
      expect(archetype.label.length).toBeGreaterThan(0);
      expect(archetype.summary.length).toBeGreaterThan(0);
      expect(archetype.behavior.length).toBeGreaterThan(0);
      expect(archetype.tactics.length).toBeGreaterThanOrEqual(2);
      expect(archetype.successHint.length).toBeGreaterThan(0);
    }
  });

  it('cobre os tipos que o time pediu', () => {
    expect(archetypeIds()).toEqual(
      expect.arrayContaining(['ideal', 'confused', 'angry', 'wants-human']),
    );
  });

  it('findArchetype devolve undefined para id desconhecido', () => {
    expect(findArchetype('cliente-inexistente')).toBeUndefined();
    expect(findArchetype('angry')?.label).toBe('Cliente bravo');
  });
});
