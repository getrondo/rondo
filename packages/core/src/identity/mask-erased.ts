import { createHash } from 'node:crypto';

import { isDefined, isEmptyArray } from '@rnw-community/shared';
import { personAlias, type telegramAuthor } from '@rondo/db/schema/identity.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, like, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { normalizeAlias } from '../extract/normalize';
import { hostOf } from '../roster/host-of';

import type { LineupFact, LineupMember } from '../extract/fact.model';

export const erasedName = 'Former player';

const keyPrefix = 'erased ';

export const isErasedKey = (column: typeof personAlias.aliasNorm | typeof telegramAuthor.displayName) => like(column, `${keyPrefix}%`);

// The key survives normalizeAlias, so a masked nickname is looked up like any other
export const erasedKey = (communityId: string, name: string): string =>
    keyPrefix + createHash('sha256').update(`${communityId}|${name}`).digest('hex');

export const loadNicknameMask = Effect.fn('Core.loadNicknameMask')(function* (communityId: string) {
    const db = yield* Db;
    const stored = yield* db
        .select({ key: personAlias.aliasNorm })
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), isErasedKey(personAlias.aliasNorm)));
    const keys = new Set(stored.map(({ key }) => key));

    return (aliasNorm: string): Option.Option<string> =>
        isEmptyArray(stored) ? Option.none() : Option.some(erasedKey(communityId, aliasNorm)).pipe(Option.filter(key => keys.has(key)));
});

const maskMember = (member: LineupMember, lineup: LineupFact, keyOf: (aliasNorm: string) => Option.Option<string>): LineupMember => {
    const { guest } = member;

    if (isDefined(guest)) {
        return Option.fromNullishOr(guest.host).pipe(
            Option.flatMap(host =>
                keyOf(Option.match(hostOf(host, lineup), { onNone: () => normalizeAlias(host), onSome: ({ aliasNorm }) => aliasNorm }))
            ),
            Option.match({ onNone: () => member, onSome: key => ({ ...member, raw: key, guest: { ...guest, host: key } }) })
        );
    }

    return Option.match(keyOf(member.aliasNorm), {
        onNone: () => member,
        onSome: key => ({ ...member, raw: key, alias: erasedName, aliasNorm: key })
    });
};

export const maskLineups = Effect.fn('Core.maskLineups')(function* (communityId: string, lineups: readonly LineupFact[]) {
    const keyOf = yield* loadNicknameMask(communityId);

    return lineups.map(lineup => ({
        ...lineup,
        teams: lineup.teams.map(team => ({ ...team, members: team.members.map(member => maskMember(member, lineup, keyOf)) }))
    }));
});

export const scrubErasedEntries = Effect.fn('Core.scrubErasedEntries')(function* (communityId: string) {
    const db = yield* Db;

    yield* db.execute(sql`
        update play.lineup_entry entry set raw = null from scheduling.session game, identity.person erased
        where game.id = entry.session_id and game.community_id = ${communityId}::uuid and erased.anonymized_at is not null
            and erased.id in (entry.person_id, entry.guest_of_person_id) and entry.raw not like ${`${keyPrefix}%`}
    `);
});
