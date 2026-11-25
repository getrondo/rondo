# Rondo

Rondo is a Telegram bot for football communities: it records games, rosters, results and ratings, starting from an import of an existing Telegram group export.

**Issue workflow: follow `~/.agent-config/agent-protocol.md`.**

`AGENTS.md` is the canonical instruction entrypoint. `CLAUDE.md` is a symlink to it. `.agents/skills/` holds supporting skills, not competing instructions.

Prefer the simplest solution that satisfies the goal and fits the existing code. A class, service, registry or config exists only when it removes real complexity.

## Commands

```bash
pnpm install
pnpm db:up                 # Postgres 17 on localhost:54329 (docker compose)
pnpm db:generate           # drizzle-kit generate (packages/db)
pnpm db:migrate            # apply migrations to DATABASE_URL
pnpm db:check              # drizzle-kit check, fails on a drifted migration set

pnpm fmt                   # oxfmt, run first, may modify files
pnpm ts                    # tsrs typecheck, every workspace plus the root
pnpm lint:check            # oxlint with the Effect language-service rules and the local lint-rules plugin
pnpm deadcode              # knip
pnpm cpd                   # jscpd
pnpm test                  # vitest per workspace through turbo, PGlite in-process Postgres (layer in @rondo/db/testing)

pnpm check                 # fmt:check, ts, lint:check, deadcode, cpd, test
```

Run `pnpm fmt && pnpm ts && pnpm lint:check && pnpm deadcode && pnpm cpd && pnpm test` before pushing. Never use `--no-verify`.

## Layout

```
apps/
  web/                  Next.js edge on Vercel: webhook, cron, the Effect runtime
packages/
  assistant/            AI assistant (Vercel AI SDK) and its tools
  bot/                  Update handlers, menus and jobs
  core/                 Domain logic, message extraction, identity, roster and community config
  db/                   Drizzle schema per bounded context, migrations, DB layer
  ingest-telegram/      Telegram history importer (parse, load, CLIs); depends on core, never the reverse
  telegram/             Telegram client layer and webhook
tests/
  test-kit/             @rondo/test-kit: vitest config factory and shared test helpers (the PGlite layer lives in @rondo/db/testing)
lint-rules/             Local oxlint plugin (effect-fn-name, effect-service-id, effect-no-run, ...)
docs/
  vision.md             Product vision
  epics/                Epic and story write-ups
  architecture/data-model.md   Data model
  adr/                  Architecture decision records
```

Links: [vision](docs/vision.md), [epics](docs/epics), [data model](docs/architecture/data-model.md), [ADRs](docs/adr).

## Load on demand

| When you are working on                                                                                        | Read                                             |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| any logic: services, repositories, errors, validation, logging, time, concurrency, database access, unit tests | `.agents/skills/effect/SKILL.md`                 |
| the Effect v4 API surface (`Context.Service`, `Schema`, `Layer`, `Effect.fn`)                                  | `node_modules/effect/AGENTS.md`                  |
| setting up Effect in a new workspace | `.agents/skills/effect-ts/SKILL.md` |
| the AI assistant, models, tools (Vercel AI SDK) | `.agents/skills/ai-sdk/SKILL.md` |
| Neon: connections, branches, compute cost (connection strings only through `isec`, never `.env`) | `.agents/skills/neon-postgres/SKILL.md` |
| SQL, indexes, locks, query cost | `.agents/skills/supabase-postgres-best-practices/SKILL.md` |
| turbo.json, pipelines, caching | `.agents/skills/turborepo/SKILL.md` |
| migrating leftover Effect v3 code                                                                              | `.agents/skills/effect-v3-to-v4/SKILL.md`        |
| the schema, a migration, or a new bounded context                                                              | `docs/architecture/data-model.md` and `docs/adr` |
| a product or scope question                                                                                    | `docs/vision.md` and `docs/epics`                |

## Critical rules

1. **No `any`.** Everything is typed.
2. **No type assertions**, in tests too. Never `as Type`, `@ts-ignore`, `@ts-expect-error`. `as const` is allowed. Narrow with guards or decode with `Schema`.
3. **No comments that say what the code does.** Self-documenting names. A single-line comment is allowed when it says why: a rule, an order or a risk the code cannot show.
4. **Never disable lint rules** without explicit user approval. No `eslint-disable` lines: a real exception is configured in `.oxlintrc.json`, as narrow as possible.
5. **No `console`.** Log through Effect (`Effect.logDebug`, `Effect.logError`), once, at the edge.
6. **Brace every control-flow body.** `if`, `else`, `for`, `while`.
7. **No abbreviated names.** `transaction` not `tx`, `message` not `msg`.
8. **Interface fields are `readonly`.** A type used by one file stays in it; a type shared by several files lives in a `*.interface.ts` or `*.model.ts` file.
9. **No enums.** Closed sets are `Schema.Literals` or tagged unions with `snake_case` values.
10. **One utility per file** with the `.util.ts` suffix, in the module `utils/` folder. No single-consumer utilities, wrappers or single-field interfaces.
11. **Never force-add ignored files.** Never commit raw Telegram exports, community configs (organizer names, squad tags) or personal data (`data/`, `exports/`, `ChatExport*/` are ignored); keep them outside the repo. Test fixtures are synthetic.

## Effect first

State-of-the-art Effect v4 is the default for every line of logic, not an option. Use the feature that removes a class of bugs; never a feature for show.

| Need | Use |
| --- | --- |
| dependencies | `Context.Service` and `Layer`, composed once at the edge; tests swap layers, never mocks |
| failures | typed errors (`Schema.TaggedError`) visible in the signature; `catchTag`, not `catchCause`, inside services; defects only for bugs |
| outside data (Telegram updates, JSON columns, model output, env, files) | `Schema.decodeUnknownEffect` at the boundary, `Config` and `Redacted`; never a cast, never `process.env` (except `drizzle.config.ts`, and `raceDatabaseUrl`, which decides which tests are skipped before any effect runs) |
| ids and units | branded `Schema` types, so ids of different things do not mix |
| variants | tagged unions with exhaustive handling that fails to compile when a case is missing |
| missing values | `Option` in domain code |
| retries, limits, time | `Schedule`, `Effect.timeout`, `Semaphore`, `DateTime`, `Clock`; never retry a Telegram send with an unknown result |
| resources | `acquireRelease`, `Scope` |
| observability | `Effect.fn` spans, structured logs and metrics without personal data |
| tests | `@effect/vitest`, `TestClock`, layers, property tests for pure logic |

Not wanted without a real need: Stream, STM, Queue, PubSub, RPC, Cluster, Workflow. A change that breaks this table needs the reason in the pull request.

## Effect

All effectful logic runs on Effect v4 (`effect`, pinned exactly). Load the `effect` skill first. Third-party skills are advice: this file, `Critical rules` and the secrets rules win. The installed `node_modules/effect/dist/*.d.ts` is authoritative for API names.

```ts
import { isDefined } from '@rnw-community/shared';
import { person } from '@rondo/db/schema/identity.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { ActionFailedError } from '../error/action-failed.error';

export const requirePerson = Effect.fn('Core.requirePerson')(function* (personId: string) {
    const db = yield* Db;
    const [found] = yield* db.select().from(person).where(eq(person.id, personId));

    return isDefined(found) ? found : yield* ActionFailedError.make({ failure: { code: 'person_not_found' } });
});
```

- **Functions.** Logic is exported `Effect.fn` functions, grouped by what they work on. What they need (`Db`, `Telegram`) is in their type, so no class or layer holds them.
- **Services.** A `Context.Service` class exists only for a dependency that is swapped or configured at the edge: `Db`, `Telegram`, `AiGateway`, `Access`. The id is `@rondo/<workspace>/<ClassName>` (lint-enforced), layers are `static readonly`, callers use only the tag (`yield* X`). No constructors, no `this`.
- **Imports by subpath.** `import * as Effect from 'effect/Effect'`, never the `effect` barrel (lint-enforced).
- **Errors.** `Schema.TaggedError` classes in `/error/*.error.ts`, created only when a caller branches on them. Everything else is a defect. A refused admin action is an `ActionFailedError` with a code and its parameters, never prose; the bot words every code in uk and ru (`failure-text.ts`). No `throw`, `try`, `new Promise` in `src/`. Wrap foreign Promise APIs with `Effect.tryPromise` at the boundary only.
- **Tracing.** Every effectful function with more than one step is `Effect.fn('Workspace.name')(function* (...) {...})`; one that only builds or delegates to another effect may be a plain arrow.
- **Running.** Only edges run effects (`apps/*` entry points, CLI mains, `it.effect` in tests). No `Effect.runPromise` or `runSync` inside services (lint-enforced).
- **Validation.** Effect `Schema` at boundaries (`Schema.decodeUnknownEffect`). No zod.
- **Database.** Drizzle over `drizzle-orm/effect-postgres` and `@effect/sql-pg`. Row types come from `typeof table.$inferSelect` and `$inferInsert`. Query functions return Effects, never builders.
- **Concurrency and time.** `Schedule`, `Effect.retry`, `Effect.timeout`, `Semaphore`, `FiberMap`, `Effect.acquireRelease`. No `setTimeout` loops or `Promise.race`.
- **Tests.** `@effect/vitest`: every test is `it.effect('...', () => Effect.gen(function* () {...}))`, `it.layer` for shared layers. DB tests run on PGlite provided as a layer from `@rondo/db/testing/test-db.layer`. No `async` bodies, no `runPromise`, no `vi.mock`. Time-dependent tests use `TestClock`.

## Git

- Conventional commits, validated by commitlint: `type(scope): subject`. Types: feat, fix, refactor, perf, docs, style, test, chore, ci, revert. Scope is a workspace name (for example `db`, `bot`, `ingest-telegram`). The PR title follows the same format and is linted.
- One PR per session, branch `type/kebab-slug`. Release notes are generated by release-please from the squash-merge titles.
- Migrations: change the Drizzle schema, run `pnpm db:generate`, commit the generated SQL and snapshot, and make sure `pnpm db:check` passes. Never edit an applied migration.

## Privacy

Rondo handles real people's names and Telegram ids. Never log or commit personal data, never paste a real export into an issue, PR or test fixture, and keep tokens in the environment (`.env` is ignored, `.env.example` documents the names).
