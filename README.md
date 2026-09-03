# CLIMB Treino 2026

App pessoal de treino para escalada e trilha, com fila A → B → C e registro automático no Cloudflare D1.

- App: https://bomdiaprod.github.io/climb-treino-2026/
- API: [climb-treino-2026-api](https://climb-treino-2026-api.od-worker.workers.dev/health)
- Banco: `climb-treino-2026-db`
- Backend e operação: [`worker/`](worker/)
- Especificação: [`docs/superpowers/specs/2026-09-02-climb-treino-2026-design.md`](docs/superpowers/specs/2026-09-02-climb-treino-2026-design.md)

Imagens de execução: [free-exercise-db](https://github.com/yuhonas/free-exercise-db), domínio público (The Unlicense).

## Como o registro funciona

Ao concluir a sessão, o app salva cada treino numa chave própria do armazenamento local,
confirma que a escrita persistiu e só então avança a fila. O envio ao D1 acontece em
seguida; falhas de internet ficam pendentes para retry automático e rejeições permanentes
podem ser copiadas pela interface para recuperação manual.

## Verificação

```bash
npm test
npm run check
```
