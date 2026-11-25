import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { instantToLocalDate } from '@rondo/core/extract/zoned-time';
import { community } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { LiveCommunityError } from '../error/live-community.error';

import type { CommunityConfig } from '@rondo/core/config/community-config';

export const assertBeforeLive = Effect.fn('IngestTelegram.assertBeforeLive')(function* (
    { slug, timeZone }: CommunityConfig,
    dates: readonly string[],
    isAcknowledged: boolean
) {
    const db = yield* Db;
    const [row] = yield* db.select({ liveSince: community.liveSince }).from(community).where(eq(community.slug, slug));

    const since = isDefined(row?.liveSince) ? instantToLocalDate(row.liveSince, timeZone) : null;
    const late = isDefined(since) ? dates.filter(date => date > since) : [];

    return yield* isDefined(since) && (!isAcknowledged || isNotEmptyArray(late))
        ? LiveCommunityError.make({ since, dates: isAcknowledged ? late : [] })
        : Effect.void;
});
