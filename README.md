# testes-automatizados-vonex

Teste automatizado de jornadas de IA no WhatsApp — substitui o ciclo manual de mandar
mensagem pelo celular, esperar a IA responder e repetir.

```
testes-automatizados-vonex/
├── CLAUDE.md              ← contexto de engenharia do projeto
└── journey-tester-cli/    ← v1: runner + cenários declarativos
```

Começar por [`journey-tester-cli/README.md`](journey-tester-cli/README.md).

```bash
cd journey-tester-cli
npm install && cp .env.example .env
npm run dev -- run scenarios/agendamento-consulta.yaml
```
