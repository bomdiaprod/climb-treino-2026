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
seguida. O registro só sai do aparelho após uma resposta de sucesso com o mesmo ID.
Falhas mantêm o registro pendente, com novas tentativas entre 5 e 60 segundos e
timeout de 15 segundos por envio. O app também retoma o envio ao recuperar a conexão,
reabrir a página ou voltar a ela. No iPhone, a página fechada pode ser suspensa;
pendências são retomadas na próxima abertura. Não há exportação ou cópia manual.

O status no topo distingue envio pendente de confirmação na base. Se o armazenamento
local estiver indisponível, a conclusão não avança a sessão nem anuncia sucesso.

## Interface de treino

O check do título recolhe o exercício para uma linha e permite reabri-lo sem perder
séries ou peso. Marcar a última série mantém o card aberto para ajuste da carga.
O registro contabiliza as séries marcadas; encerrar sem séries significa não feito.
“Parar tempo” controla apenas o cronômetro; “Concluí” salva e avança a sessão.
Reiniciar exige confirmação e preserva os treinos já registrados ou aguardando envio.

## Verificação

```bash
npm test
npm run check
```
