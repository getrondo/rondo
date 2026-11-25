import { expect, layer } from '@effect/vitest';
import { seedCommunity } from '@rondo/core/testing/seed-community';
import { community } from '@rondo/db/schema/org.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { importMessages } from '../src/ingest.effect';

import { message, testConfig } from './fixture';

const messages = [
    message(1, '2025-05-03T10:00:00Z', '', { poll: { question: 'Понедельник, 5 мая, 19.00 North', answers: ['+', '-'] } }),
    message(2, '2025-05-05T10:00:00Z', 'Составы на сегодня, 19.00:\n🟢Гонзо, Борис\n🔵Олег, Семён')
];

const importAs = (slug: string, acknowledgeLive: boolean) =>
    importMessages({
        config: { ...testConfig, slug },
        messages,
        fileSha256: 'sha',
        snapshot: Option.none(),
        allowRemoval: true,
        acknowledgeLive
    });

const liveFrom = Effect.fn('test.liveFrom')(function* (slug: string, liveSince: Date) {
    const db = yield* Db;
    yield* db.update(community).set({ liveSince }).where(eq(community.slug, slug));
});

layer(testDbLayer, { timeout: 60_000 })('an import of a live community', it => {
    it.effect('is refused without the acknowledgement and for games after the day the main group was linked', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'cutoff-fc';
            const { communityId } = yield* seedCommunity({ ...testConfig, slug });
            yield* importAs(slug, false);
            const before = yield* db.select({ id: session.id }).from(session).where(eq(session.communityId, communityId));
            yield* liveFrom(slug, new Date('2030-01-01T10:00:00Z'));
            const unaware = yield* importAs(slug, false).pipe(Effect.flip);
            const aware = yield* importAs(slug, true).pipe(Effect.exit);
            yield* liveFrom(slug, new Date('2020-01-01T10:00:00Z'));
            const late = yield* importAs(slug, true).pipe(Effect.flip);
            const after = yield* db.select({ id: session.id }).from(session).where(eq(session.communityId, communityId));

            expect(before.length).toBeGreaterThan(0);
            expect(unaware).toMatchObject({ _tag: 'LiveCommunityError', since: '2030-01-01', dates: [] });
            expect(String(unaware)).toContain('RONDO_ACKNOWLEDGE_LIVE=true');
            expect(aware._tag).toBe('Success');
            expect(late._tag === 'LiveCommunityError' ? late.dates.length : 0).toBeGreaterThan(0);
            expect(after).toHaveLength(before.length);
        })
    );
});
