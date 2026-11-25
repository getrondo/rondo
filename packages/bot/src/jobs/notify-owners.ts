import { isNotEmptyArray } from '@rnw-community/shared';
import { Access } from '@rondo/core/access/admin-access';
import { recipientsOf } from '@rondo/core/access/recipients-of';
import { Db } from '@rondo/db/service/db.service';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { menuText } from '../menu/menu-text';

type OwnerNotice = 'ownerDroppedUpdates' | 'ownerMaintenanceFailed' | 'ownerTeamsFailed';

const claimNotice = Effect.fn('Bot.claimOwnerNotice')(function* (notice: OwnerNotice, now: Date) {
    const db = yield* Db;
    const day = now.toISOString().slice(0, 10);
    const inserted = yield* db.execute(sql`
        insert into audit.log (id, actor_kind, action, entity_type, entity_id, at)
        select gen_random_uuid(), 'bot', ${notice}, 'system', ${day}, ${now}
        where not exists (select 1 from audit.log where action = ${notice} and entity_type = 'system' and entity_id = ${day})
        returning id
    `);

    return isNotEmptyArray(inserted.rows);
});

// One private message a day about each kind of trouble, a number and never a name or a text
const notifyOwners = Effect.fn('Bot.notifyOwners')(function* (notice: OwnerNotice, count: number, now: Date) {
    const access = yield* Access;
    const telegram = yield* Telegram;

    if (count === 0 || !(yield* claimNotice(notice, now))) {
        return;
    }

    for (const owner of yield* recipientsOf([...access.ownerTgUserIds])) {
        yield* telegram
            .call('sendMessage', api => api.sendMessage(Number(owner.tgUserId), menuText(owner.locale, notice, { count })))
            .pipe(
                Effect.catchTag('TelegramApiError', error => Effect.logWarning('[owners] not reached', { isUncertain: error.isUncertain }))
            );
    }
});

export const notifyOwnersOfFailure = (notice: OwnerNotice, count: number, now: Date) =>
    notifyOwners(notice, count, now).pipe(Effect.catchCause(cause => Effect.logError('[owners] notice failed', cause)));
