---
name: effect
description: Mandatory before writing or reviewing ANY logic in this repo - async, IO, errors, services, database, HTTP, background work, state, logging, time, concurrency or tests. All logic is Effect v4 (effect@4); load this skill first.
---

# Effect in Rondo

Every effectful line is Effect. No Promise/async logic, `try`/`throw`, `new Promise`, `setTimeout` loops or cancelled-flag fetches outside the edges below. Pure code (math, parsers, mappers, predicate builders) stays plain TypeScript.

## API truth, in order

1. `node_modules/effect/AGENTS.md` and `node_modules/effect/ai-docs/src/**` (ships with the pinned version), then `node_modules/effect/dist/*.d.ts` and `node_modules/effect/src`.
2. `https://github.com/Effect-TS/effect/blob/main/LLMS.md`.
3. The repo's root `AGENTS.md` "## Effect" section and rules 22, 32, 35, 41, 57, 58, 60.
4. Migrating leftover v3 code: the `effect-v3-to-v4` skill. Never write v3 APIs (`Effect.Service`, `Context.Tag`, `catchAll`); v4 is `Context.Service`, `Effect.catch`.

## Repo patterns

- Imports by subpath only: `import * as Effect from 'effect/Effect'`, never the `effect` barrel.
- Functions: service methods are `m: Effect.fn('X.m')(function* (...) {...})` in the object returned by `make`, named after the service; hot-loop helpers are `make` locals with `Effect.fnUntraced`. A method whose body is one call (a single query, or a delegation) is a plain arrow `m: (a: A) => dep.m(a)`, with no `Effect.fn`. Pass another service's method as a value only through an arrow (`(a) => repo.m(a)`).
- Database: Drizzle over `drizzle-orm/effect-postgres` with `@effect/sql-pg`. Schemas live in `packages/db`, one folder per bounded context. Repositories are services returning Effects, never Drizzle builders. Atomic work runs in a single transaction effect.
- Errors: typed channel only. `Schema.TaggedError` classes in `/error/*.error.ts`, created only when a caller branches on them; everything else is a defect. Wrap foreign Promise/SDK/native calls with `Effect.tryPromise`/`Effect.try` at that boundary only. Recover only at edges with `Effect.catchTag`/`catchTags`/`catch`. Log failures once at the edge.
- Services: every service and repository is `class X extends Context.Service<X>()('@rondo/<pkg>/X', { make: Effect.gen(function* () { const dep = yield* Dep; ...; return { m } }) }) { static readonly layer = Layer.effect(X, X.make).pipe(Layer.provide([Dep.layer])) }` (`make: Effect.succeed({...})` without dependencies). No constructors, no `this`: dependencies resolve once at the top of `make`, helpers, constants and state are `make` locals, shared repository behaviour is a `make<X>Repository(...)` factory spread into the returned object. Callers use only the tag (`yield* X`, `Effect.flatMap(X, x => ...)`, never `X.use`). Ports (`Db`) are layer-less tags. Pure code stays plain with no tag. 
- Validation: Effect `Schema` at boundaries (`Schema.decodeUnknownEffect`, `Schema.toStandardSchemaV1` for forms). No zod, ky or drizzle-zod.
- HTTP: `HttpClient` from `effect/http` with `Schedule` retries and `Effect.timeout`; the runtime provides `FetchHttpClient.layer`.
- Concurrency and time: `Schedule`, `Effect.retry`/`repeat`, `Effect.timeout`, `Effect.sleep`, `Semaphore`, `FiberMap`/`FiberSet`, `Effect.acquireRelease`. No `Promise.race`, generation counters or boolean cancel flags.
- Runtime edges: only `apps/*` entry points (bot boot, workers, importers CLI) run effects, via `Effect.runPromise`/`runFork` or `NodeRuntime.runMain`. Services never run effects.
- Logging: `Effect.logDebug`/`logError` and `Effect.tapCause(Effect.logError)` at edges. Never `console.*`.
- Tests: `@effect/vitest` with `it.effect` (and `it.layer` for shared layers). Never `async` test bodies or `runPromise` inside a test. Tests use PGlite (in-process Postgres) provided as a layer from `tests/test-kit`.

## Before finishing

`pnpm ts && pnpm lint`; check no `async`, `await`, `try`, `throw`, `new Promise`, `Effect.runPromise`/`runSync` in services.
