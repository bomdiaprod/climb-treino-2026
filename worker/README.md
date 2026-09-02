# Operação — Treino CLIMB 2026

Backend de gravação dos treinos concluídos no app.

## Recursos

- Worker: `climb-treino-2026-api`
- API: `https://climb-treino-2026-api.od-worker.workers.dev`
- D1: `climb-treino-2026-db`
- Binding: `DB`
- Projeto gravado nas linhas: `climb-treino-2026`

O HTTP público aceita somente `POST /v1/workouts` e `GET /health`. Não existe rota
pública para ler ou alterar treinos.

## Desenvolvimento e publicação

```bash
npm install
npm test
npm run typecheck
npm run deploy:dry
npx wrangler d1 migrations apply climb-treino-2026-db --remote
npx wrangler deploy
```

## Contabilizar treinos no vault

Consultar as pendências pelo Wrangler autenticado neste Mac:

```bash
npx wrangler d1 execute climb-treino-2026-db --remote --json --command "SELECT id, session, started_at, completed_at, duration_minutes, log_text FROM workouts WHERE status = 'pending' ORDER BY completed_at;"
```

Depois de inserir e conferir os registros no vault, rode o linter. Somente se a gravação e
o linter terminarem sem erro, marque exatamente os IDs importados como processados:

```sql
UPDATE workouts
SET status = 'processed',
    processed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN ('id-confirmado-1', 'id-confirmado-2')
  AND status = 'pending';
```

Execute o `UPDATE` com:

```bash
npx wrangler d1 execute climb-treino-2026-db --remote --command "UPDATE workouts SET status = 'processed', processed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id IN ('id-confirmado-1', 'id-confirmado-2') AND status = 'pending';"
```
