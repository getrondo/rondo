import { isDefined } from '@rnw-community/shared';
import { personAlias, telegramAuthor } from '@rondo/db/schema/identity.schema';
import { and, eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { aliasesIn } from '../identity/aliases-in';
import { ensureAliases } from '../identity/ensure-aliases';
import { insertMany } from '../utils/insert-many.util';

import type { Directory } from '../interface/directory.interface';
import type { LoadContext } from '../interface/load-context.interface';

export const insertPeople = Effect.fn('IngestTelegram.insertPeople')(function* (context: LoadContext, directory: Directory) {
    const { transaction, communityId, config, plan } = context;
    const lineups = plan.sessions.map(({ lineup }) => lineup).filter(lineup => isDefined(lineup));
    const aliases = aliasesIn(lineups, directory, config.organizers[0] ?? 'Organizer');

    yield* ensureAliases({ communityId, source: 'import', aliases });

    const selfNorm = aliases.find(({ kind }) => kind === 'self')?.aliasNorm ?? '';
    const [self] = yield* transaction
        .select({ personId: personAlias.personId })
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), eq(personAlias.aliasNorm, selfNorm)));

    yield* insertMany(plan.facts.authors, batch =>
        transaction
            .insert(telegramAuthor)
            .values(
                batch.map(author => ({
                    communityId,
                    displayName: author.displayName,
                    personId: isDefined(self) && author.displayName === config.organizers[0] ? self.personId : null,
                    messageCount: author.messageCount,
                    firstSeenAt: author.firstSeenAt,
                    lastSeenAt: author.lastSeenAt
                }))
            )
            .onConflictDoUpdate({
                target: [telegramAuthor.communityId, telegramAuthor.displayName],
                set: {
                    personId: sql`coalesce(${telegramAuthor.personId}, excluded.person_id)`,
                    messageCount: sql`excluded.message_count`,
                    firstSeenAt: sql`excluded.first_seen_at`,
                    lastSeenAt: sql`excluded.last_seen_at`
                }
            })
    );

    return aliases.length;
});
