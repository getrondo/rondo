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
  bot/                  Telegram bot (grammY or similar edge), runs the Effect runtime
  miniapp/              Telegram Mini App (future)
packages/
  db/                   Drizzle schema per bounded context, migrations, DB layer
  ingest-telegram/      Telegram export importer (HTML export to domain rows)
  domain/               Domain services and Schema types (future)
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
| migrating leftover Effect v3 code                                                                              | `.agents/skills/effect-v3-to-v4/SKILL.md`        |
| the schema, a migration, or a new bounded context                                                              | `docs/architecture/data-model.md` and `docs/adr` |
| a product or scope question                                                                                    | `docs/vision.md` and `docs/epics`                |

## Critical rules

1. **No `any`.** Everything is typed.
2. **No type assertions.** Never `as Type`, `@ts-ignore`, `@ts-expect-error`. `as const` is allowed. Narrow with guards or decode with `Schema`.
3. **No comments.** Self-documenting names. At most one single-line header per file.
4. **Never disable lint rules** without explicit user approval.
5. **No `console`.** Log through Effect (`Effect.logDebug`, `Effect.logError`), once, at the edge.
6. **Brace every control-flow body.** `if`, `else`, `for`, `while`.
7. **No abbreviated names.** `transaction` not `tx`, `message` not `msg`.
8. **Interface fields are `readonly`.** Interfaces and type aliases live in `/interface` (`*.interface.ts`, `*.type.ts`), never inline above services or repositories.
9. **Enums are `UPPER_CASE` members with `UPPER_CASE` string values.**
10. **One utility per file** with the `.util.ts` suffix, in the module `utils/` folder. No single-consumer utilities, wrappers or single-field interfaces.
11. **Never force-add ignored files.** Never commit raw Telegram exports, community configs (organizer names, squad tags) or personal data (`data/`, `exports/`, `ChatExport*/` are ignored); keep them outside the repo. Test fixtures are synthetic.

## Effect

All effectful logic runs on Effect v4 (`effect`, pinned exactly). Load the `effect` skill first. The installed `node_modules/effect/dist/*.d.ts` is authoritative for API names.

```ts
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';

export class PlayerNotFoundError extends Schema.TaggedError<PlayerNotFoundError>()('PlayerNotFoundError', {
    playerId: Schema.String
}) {}

export class PlayerService extends Context.Service<PlayerService>()('@rondo/domain/PlayerService', {
    make: Effect.gen(function* () {
        const playerRepository = yield* PlayerRepository;

        return {
            findById: Effect.fn('PlayerService.findById')(function* (playerId: string) {
                const player = yield* playerRepository.findById(playerId);

                if (player === null) {
                    return yield* new PlayerNotFoundError({ playerId });
                }

                return player;
            })
        };
    })
}) {
    static readonly layer = Layer.effect(PlayerService, PlayerService.make).pipe(Layer.provide(PlayerRepository.layer));
}
```

- **Services.** Every service and repository is a `Context.Service` class with a `make` recipe. The id is `@rondo/<workspace>/<ClassName>` (lint-enforced). No constructors, no `this`. Callers use only the tag (`yield* X`). Layers are `static readonly`.
- **Imports by subpath.** `import * as Effect from 'effect/Effect'`, never the `effect` barrel (lint-enforced).
- **Errors.** `Schema.TaggedError` classes in `/error/*.error.ts`, created only when a caller branches on them. Everything else is a defect. No `throw`, `try`, `new Promise` in `src/`. Wrap foreign Promise APIs with `Effect.tryPromise` at the boundary only.
- **Tracing.** Every effectful service method is `m: Effect.fn('X.m')(function* (...) {...})`, named after the service and method.
- **Running.** Only edges run effects (`apps/*` entry points, CLI mains, `it.effect` in tests). No `Effect.runPromise` or `runSync` inside services (lint-enforced).
- **Validation.** Effect `Schema` at boundaries (`Schema.decodeUnknownEffect`). No zod.
- **Database.** Drizzle over `drizzle-orm/effect-postgres` and `@effect/sql-pg`. Row types come from `typeof table.$inferSelect` and `$inferInsert`. Repositories return Effects, never builders.
- **Concurrency and time.** `Schedule`, `Effect.retry`, `Effect.timeout`, `Semaphore`, `FiberMap`, `Effect.acquireRelease`. No `setTimeout` loops or `Promise.race`.
- **Tests.** `@effect/vitest`: every test is `it.effect('...', () => Effect.gen(function* () {...}))`, `it.layer` for shared layers. DB tests run on PGlite provided as a layer from `@rondo/db/testing/test-db.layer`. No `async` bodies, no `runPromise`, no `vi.mock`. Time-dependent tests use `TestClock`.

## Git

- Conventional commits, validated by commitlint: `type(scope): subject`. Types: feat, fix, refactor, perf, docs, style, test, chore, ci, revert. Scope is a workspace name (for example `db`, `bot`, `ingest-telegram`). The PR title follows the same format and is linted.
- One PR per session, branch `type/kebab-slug`. Release notes are generated by release-please from the squash-merge titles.
- Migrations: change the Drizzle schema, run `pnpm db:generate`, commit the generated SQL and snapshot, and make sure `pnpm db:check` passes. Never edit an applied migration.

## Privacy

Rondo handles real people's names and Telegram ids. Never log or commit personal data, never paste a real export into an issue, PR or test fixture, and keep tokens in the environment (`.env` is ignored, `.env.example` documents the names).
