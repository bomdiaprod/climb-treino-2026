# CLIMB Treino 2026 — registro automático de treinos

Data: 2026-09-02

## Objetivo

Transformar o app atual em uma fonte confiável de registros de treino. Finalizar uma
sessão no iPhone deve gravá-la automaticamente numa base Cloudflare. Quando Fellipe pedir
para contabilizar os treinos, o agente consulta as sessões pendentes, atualiza o vault e só
então marca os registros como processados.

O app não abre nem escreve diretamente no Obsidian. O cache do navegador continua sendo
usado apenas para estado transitório da sessão e da fila.

## Nome canônico e organização

Todos os recursos usam o mesmo radical para deixar propriedade e finalidade explícitas:

| Recurso | Nome |
|---|---|
| Repositório GitHub | `bomdiaprod/climb-treino-2026` |
| App | `Treino CLIMB 2026` |
| GitHub Pages | `https://bomdiaprod.github.io/climb-treino-2026/` |
| Worker | `climb-treino-2026-api` |
| Banco D1 | `climb-treino-2026-db` |
| Identificador de projeto | `climb-treino-2026` |
| Binding D1 no Worker | `DB` |

O repositório mantém frontend e backend juntos:

```text
climb-treino-2026/
├── index.html
├── academia-log.js
├── img/
├── README.md
├── docs/superpowers/specs/
└── worker/
    ├── migrations/
    ├── src/
    ├── test/
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    ├── wrangler.jsonc
    └── README.md
```

## Modelo de dados

A tabela `workouts` é a fila de importação, não um espelho do Markdown:

| Campo | Tipo | Regra |
|---|---|---|
| `id` | TEXT | chave primária; ID estável criado no app |
| `project` | TEXT | sempre `climb-treino-2026` |
| `session` | TEXT | `A`, `B` ou `C` |
| `started_at` | TEXT | ISO 8601 |
| `completed_at` | TEXT | ISO 8601 |
| `duration_minutes` | INTEGER | zero ou positivo |
| `log_text` | TEXT | registro factual pronto para o diário |
| `payload_json` | TEXT | estado estruturado da sessão para auditoria |
| `status` | TEXT | `pending` ou `processed` |
| `created_at` | TEXT | preenchido pelo banco |
| `processed_at` | TEXT | nulo até a importação |

O banco rejeita estados e sessões fora do vocabulário. Repetir o mesmo `id` é
idempotente: a operação retorna o registro existente, sem criar uma segunda sessão.

## API e segurança

O Worker expõe somente:

- `POST /v1/workouts` — recebe uma sessão concluída;
- `GET /health` — informa disponibilidade, sem retornar dados pessoais.

Leitura de pendências e mudança para `processed` não ficam em HTTP público. O agente usa
`wrangler d1 execute --remote` pela sessão Cloudflare autenticada neste Mac. Assim, nenhuma
chave administrativa entra no HTML, no GitHub ou no vault.

O endpoint de gravação aplica:

- CORS restrito ao GitHub Pages do projeto;
- método e `Content-Type` estritos;
- limite de tamanho do corpo;
- validação completa do payload;
- `project` fixado pelo servidor, sem confiar no cliente;
- consultas D1 parametrizadas;
- respostas sem detalhes internos e logs estruturados.

O `Origin` reduz uso acidental por outros sites, mas não é tratado como autenticação.
Como uma credencial embutida num app público também seria pública, não haverá segredo de
gravação falso. O impacto fica limitado por validação, idempotência, tamanho e escopo de
uma única tabela. Se abuso real aparecer, Turnstile pode ser acrescentado depois.

## Fluxo no app

Ao tocar em **Concluí — avançar a fila**:

1. o app encerra o cronômetro e monta o registro;
2. grava uma cópia numa outbox local antes da chamada de rede;
3. envia o payload estruturado ao Worker;
4. após confirmação, remove o item da outbox e avança a fila;
5. em falha de rede, mantém o item e mostra `Registro pendente de envio`;
6. na próxima abertura ou conclusão, tenta reenviar a outbox automaticamente.

A gravação direta via `obsidian://` será removida. O app nunca perde silenciosamente um
treino por falta de internet e nunca avança a fila antes de preservar o payload localmente.

## Fluxo de contabilização no vault

Quando Fellipe disser **contabilize os treinos**:

1. consultar `workouts WHERE status = 'pending' ORDER BY completed_at`;
2. comparar os IDs com o controle local para impedir reimportação;
3. inserir as sessões ausentes em `diario-de-treino.md`, mais recente no topo;
4. atualizar as métricas factuais aplicáveis;
5. rodar o linter do vault;
6. somente se a gravação e o linter passarem, marcar os IDs importados como `processed`
   e preencher `processed_at`.

A nota `entrada-de-treinos.md`, criada para o desenho anterior, será convertida em uma
nota curta de controle da integração. Ela documenta a fonte Cloudflare e o procedimento,
mas não recebe registros brutos nem duplica o banco.

## Migração e compatibilidade

- Renomear o repositório `fila` para `climb-treino-2026` preserva o histórico Git.
- Atualizar README, títulos, links do vault e qualquer referência ao endereço antigo.
- O endereço novo passa a ser a fonte oficial. O redirecionamento automático do GitHub
  após renomear é conveniência temporária, não dependência do sistema.
- A versão publicada atual, que abre o Obsidian, é substituída pela integração D1.
- Não migrar estados transitórios antigos do `localStorage`; apenas preservar as chaves
  existentes de fila, marcações e histórico de carga.

## Testes e verificação

- testes unitários para validação, IDs, idempotência e respostas de erro;
- teste de integração local do Worker com D1;
- teste do app para outbox, sucesso e falha de rede;
- `wrangler types`, checagem TypeScript e `wrangler deploy --dry-run`;
- migração D1 local antes da remota;
- smoke test remoto: `health`, criação, repetição sem duplicar, consulta via Wrangler
  e marcação de um registro de teste;
- confirmação do novo GitHub Pages e linter do vault.

Dados de teste remotos usam IDs e logs explicitamente marcados como teste e são removidos
depois da verificação.

## Fora de escopo

- painel web de administração;
- login de usuário;
- sincronização em tempo real com o Obsidian;
- relatórios ou gráficos no app;
- Turnstile sem evidência de abuso.
