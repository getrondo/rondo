import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, layer } from '@effect/vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/effect-postgres/migrator';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';

import { runMigrations } from '../src/migration/migrate.effect';
import { person } from '../src/schema/identity.schema';
import { community, membership } from '../src/schema/org.schema';
import { Db } from '../src/service/db.service';
import { unmigratedDbLayer } from '../src/testing/test-db.layer';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const dropMigration = '20261125162626_drop_unused_tables';
const droppedTables = [
    ...readFileSync(join(migrationsFolder, dropMigration, 'migration.sql'), 'utf8').matchAll(/DROP TABLE (?<table>[^;]+);/gu)
].map(({ groups }) => groups?.table ?? '');

const migrateToPrevious = Effect.fn('test.migrateToPrevious')(function* () {
    const db = yield* Db;
    const folder = yield* Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), 'rondo-migrations-'))),
        path => Effect.sync(() => rmSync(path, { recursive: true }))
    );
    for (const name of readdirSync(migrationsFolder).filter(migration => migration < dropMigration)) {
        cpSync(join(migrationsFolder, name), join(folder, name), { recursive: true });
    }
    yield* migrate(db, { migrationsFolder: folder, migrationsSchema: 'drizzle', migrationsTable: 'migrations' });
});

const existingTables = Effect.fn('test.existingTables')(function* () {
    const db = yield* Db;
    let existing = 0;
    for (const table of droppedTables) {
        const { rows } = yield* db.execute<{ readonly found: boolean }>(sql`select to_regclass(${table}) is not null as found`);
        existing += rows[0]?.found === true ? 1 : 0;
    }

    return existing;
});

layer(unmigratedDbLayer, { timeout: 120_000 })('drop of the unused tables', it => {
    it.effect('refuses while any of them has a row, then drops them and keeps the rest', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            yield* migrateToPrevious();
            const people = yield* db
                .insert(person)
                .values([{ displayName: 'Kept' }, { displayName: 'Merged' }])
                .returning({ id: person.id });
            const [kept = '', merged = ''] = people.map(({ id }) => id);
            const [home] = yield* db.insert(community).values({ slug: 'home', name: 'Home' }).returning({ id: community.id });
            const communityId = home?.id ?? '';
            yield* db.insert(membership).values([
                { communityId, personId: kept, status: 'left' },
                { communityId, personId: merged }
            ]);

            // Without foreign key checks every table can be filled alone
            yield* db.execute(sql`set session_replication_role = replica`);
            for (const table of droppedTables) {
                const { rows: columns } = yield* db.execute<{ readonly column: string; readonly value: string }>(sql`
                    select quote_ident(att.attname) as column,
                        case
                            when typ.typtype = 'e' then quote_literal((select enumlabel from pg_enum where enumtypid = typ.oid limit 1))
                            when typ.typname = 'uuid' then 'gen_random_uuid()'
                            when typ.typname in ('timestamptz', 'date') then 'now()'
                            when typ.typname = 'tstzrange' then quote_literal('(,)')
                            when typ.typname in ('json', 'jsonb') then quote_literal('{}')
                            else quote_literal('1')
                        end as value
                    from pg_attribute att join pg_type typ on typ.oid = att.atttypid
                    where att.attrelid = ${table}::regclass and att.attnum > 0 and att.attnotnull and not att.atthasdef`);
                yield* db.execute(
                    sql.raw(
                        `insert into ${table} (${columns.map(({ column }) => column).join(', ')}) values (${columns.map(({ value }) => value).join(', ')})`
                    )
                );
                const refused = yield* Effect.exit(runMigrations());
                yield* db.execute(sql.raw(`delete from ${table}`));

                expect(Exit.isFailure(refused)).toBe(true);
                expect(String(refused)).toContain(`table ${table} is not empty`);
                expect(yield* existingTables()).toBe(droppedTables.length);
            }
            yield* db.execute(sql`set session_replication_role = default`);

            yield* runMigrations();
            yield* db.execute(sql`select identity.merge_person(${merged}::uuid, ${kept}::uuid)`);
            const memberships = yield* db.select({ personId: membership.personId, status: membership.status }).from(membership);

            expect(droppedTables).toHaveLength(30);
            expect(yield* existingTables()).toBe(0);
            expect(memberships).toEqual([{ personId: kept, status: 'active' }]);
        })
    );
});
