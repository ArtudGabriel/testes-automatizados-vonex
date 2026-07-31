import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';
import { projectSchema, type ProjectSpec } from './project.schema';
import { scenarioSchema, type ScenarioSpec } from './scenario.schema';

export interface LoadedScenario {
  filePath: string;
  spec: ScenarioSpec;
  /** Briefing já resolvido — inline ou vindo de `projectFile`. */
  project?: ProjectSpec;
}

const SCENARIO_EXTENSIONS = new Set(['.yaml', '.yml']);

export function loadScenario(filePath: string): LoadedScenario {
  const absolute = resolve(filePath);
  const raw = readFileSync(absolute, 'utf8');

  let document: unknown;
  try {
    document = parseYaml(raw);
  } catch (error) {
    throw new Error(`YAML inválido em ${absolute}: ${(error as Error).message}`);
  }

  let spec: ScenarioSpec;
  try {
    spec = scenarioSchema.parse(document);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Cenário inválido em ${absolute}:\n${formatZodError(error)}`);
    }
    throw error;
  }

  const project = spec.projectFile
    ? loadProject(spec.projectFile, dirname(absolute))
    : spec.project;

  return { filePath: absolute, spec, ...(project ? { project } : {}) };
}

/** `projectFile` é resolvido relativo ao arquivo do cenário, não ao cwd. */
export function loadProject(filePath: string, baseDir: string): ProjectSpec {
  const absolute = isAbsolute(filePath) ? filePath : resolve(baseDir, filePath);

  let document: unknown;
  try {
    document = parseYaml(readFileSync(absolute, 'utf8'));
  } catch (error) {
    throw new Error(`Não consegui ler o projeto em ${absolute}: ${(error as Error).message}`);
  }

  try {
    return projectSchema.parse(document);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Projeto inválido em ${absolute}:\n${formatZodError(error)}`);
    }
    throw error;
  }
}

/** Aceita arquivo ou diretório; diretório carrega todos os .yaml/.yml. */
export function loadScenarios(paths: string[]): LoadedScenario[] {
  const files = paths.flatMap((path) => expandPath(path));
  const unique = [...new Set(files)].sort();
  return unique.map((file) => loadScenario(file));
}

function expandPath(path: string): string[] {
  const absolute = resolve(path);
  if (!statSync(absolute).isDirectory()) return [absolute];

  return readdirSync(absolute)
    .filter((entry) => SCENARIO_EXTENSIONS.has(extname(entry)))
    .map((entry) => join(absolute, entry));
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(raiz)';
      return `  ${path}: ${issue.message}`;
    })
    .join('\n');
}
