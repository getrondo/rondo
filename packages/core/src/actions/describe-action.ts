import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { person, personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Predicate from 'effect/Predicate';

import { cancelReasonText, formatSessionLabel } from '../i18n/messages';
import { getSession } from '../sessions/session.service';

import type { Locale } from '../i18n/locale';
import type { Action } from './action.model';

const nameOfPerson = Effect.fn('Core.nameOfPerson')(function* (personId: string) {
    const db = yield* Db;
    const [row] = yield* db
        .select({ name: person.displayName, username: telegramAccount.username })
        .from(person)
        .leftJoin(telegramAccount, eq(telegramAccount.personId, person.id))
        .where(eq(person.id, personId));

    return isDefined(row?.username) ? `${row.name} (@${row.username})` : (row?.name ?? personId);
});

const nickname = Effect.fn('Core.nickname')(function* (aliasId: string) {
    const db = yield* Db;
    const [row] = yield* db.select({ alias: personAlias.alias }).from(personAlias).where(eq(personAlias.id, aliasId));

    return row?.alias ?? aliasId;
});

const nameOfVenue = Effect.fn('Core.nameOfVenue')(function* (venueId: string | null | undefined) {
    const db = yield* Db;

    if (!isDefined(venueId)) {
        return null;
    }

    const [row] = yield* db.select({ name: venue.name }).from(venue).where(eq(venue.id, venueId));

    return row?.name ?? null;
});

const sessionLabel = Effect.fn('Core.sessionLabel')(function* (locale: Locale, sessionId: string) {
    const found = yield* getSession(sessionId);

    return Option.match(found, { onNone: () => sessionId, onSome: value => formatSessionLabel(locale, value) });
});

const words = {
    uk: {
        create: '➕ Нова гра',
        announce: 'і опублікувати опитування в групі',
        update: '✏️ Змінити гру',
        cancel: '❌ Скасувати гру',
        notify: 'з повідомленням у групі',
        publishPoll: '📣 Опублікувати опитування',
        teams: '👥 Опублікувати склади',
        merge: '🔗 Обʼєднати гравців',
        link: '🔗 Привʼязати прізвисько',
        unlink: '✂️ Відвʼязати прізвисько',
        rename: '✏️ Перейменувати',
        admin: '🛡 Зробити адміністратором',
        rating: '⭐ Рівень гравця',
        person: '👤 Новий гравець',
        venue: '📍 Нове поле',
        venueChange: '📍 Змінити поле',
        venueOff: 'більше не використовувати',
        venueOn: 'знову використовувати',
        alias: 'також',
        places: 'місць'
    },
    ru: {
        create: '➕ Новая игра',
        announce: 'и опубликовать опрос в группе',
        update: '✏️ Изменить игру',
        cancel: '❌ Отменить игру',
        notify: 'с уведомлением в группе',
        publishPoll: '📣 Опубликовать опрос',
        teams: '👥 Опубликовать составы',
        merge: '🔗 Объединить игроков',
        link: '🔗 Привязать прозвище',
        unlink: '✂️ Отвязать прозвище',
        rename: '✏️ Переименовать',
        admin: '🛡 Сделать администратором',
        rating: '⭐ Уровень игрока',
        person: '👤 Новый игрок',
        venue: '📍 Новое поле',
        venueChange: '📍 Изменить поле',
        venueOff: 'больше не использовать',
        venueOn: 'снова использовать',
        alias: 'также',
        places: 'мест'
    }
} as const;

export const describeAction = Effect.fn('Core.describeAction')(function* (action: Action, locale: Locale) {
    const word = words[locale];

    switch (action._tag) {
        case 'create_session': {
            const venueName = yield* nameOfVenue(action.venueId);
            const label = formatSessionLabel(locale, { ...action, venueName });
            const capacity = isDefined(action.capacityMax) ? `, ${action.capacityMax} ${word.places}` : '';

            return `${word.create}: ${label}${capacity}${action.announce ? ` ${word.announce}` : ''}`;
        }
        case 'update_session': {
            const before = yield* getSession(action.sessionId);
            const venueName = Predicate.isUndefined(action.venueId)
                ? before.pipe(
                      Option.map(value => value.venueName),
                      Option.getOrNull
                  )
                : yield* nameOfVenue(action.venueId);
            const after = before.pipe(
                Option.map(value =>
                    formatSessionLabel(locale, {
                        localDate: action.localDate ?? value.localDate,
                        localTime: action.localTime ?? value.localTime,
                        venueName
                    })
                )
            );
            const capacity = isDefined(action.capacityMax) ? `, ${action.capacityMax} ${word.places}` : '';

            return `${word.update}: ${yield* sessionLabel(locale, action.sessionId)} → ${Option.getOrElse(after, () => '?')}${capacity}${action.notify ? ` (${word.notify})` : ''}`;
        }
        case 'cancel_session': {
            return `${word.cancel}: ${yield* sessionLabel(locale, action.sessionId)} — ${cancelReasonText(locale, action.reason)}${action.notify ? ` (${word.notify})` : ''}`;
        }
        case 'announce_session': {
            return `${word.publishPoll}: ${yield* sessionLabel(locale, action.sessionId)}`;
        }
        case 'publish_teams': {
            const lines = action.teams.map(
                team =>
                    `${team.ordinal}. ${team.players.map(player => `${player.displayName}${player.isGk ? ' 🧤' : ''}`).join(', ')} (Σ ${team.strength.toFixed(1)})`
            );

            return [`${word.teams}: ${yield* sessionLabel(locale, action.sessionId)}`, ...lines].join('\n');
        }
        case 'merge_people': {
            return `${word.merge}: «${yield* nameOfPerson(action.fromPersonId)}» → «${yield* nameOfPerson(action.intoPersonId)}»`;
        }
        case 'link_alias': {
            return `${word.link}: «${yield* nickname(action.aliasId)}» → «${yield* nameOfPerson(action.personId)}»`;
        }
        case 'unlink_alias': {
            return `${word.unlink}: «${yield* nickname(action.aliasId)}»`;
        }
        case 'rename_person': {
            return `${word.rename}: «${yield* nameOfPerson(action.personId)}» → «${action.displayName}»`;
        }
        case 'grant_admin': {
            return `${word.admin}: ${yield* nameOfPerson(action.personId)}`;
        }
        case 'set_rating': {
            return `${word.rating}: ${yield* nameOfPerson(action.personId)} = ${action.level}/10`;
        }
        case 'create_person': {
            return `${word.person}: ${action.displayName}`;
        }
        case 'create_venue': {
            const game = isDefined(action.sessionId) ? ` → ${yield* sessionLabel(locale, action.sessionId)}` : '';

            return `${word.venue}: ${[action.name, action.address].filter(part => isNotEmptyString(part)).join(', ')}${game}`;
        }
        case 'update_venue': {
            const active = isDefined(action.active) ? [action.active ? word.venueOn : word.venueOff] : [];
            const alias = isDefined(action.alias) ? [`${word.alias} «${action.alias}»`] : [];
            const details = [action.name, action.address, action.district, action.indoor].filter(part => isDefined(part));

            return `${word.venueChange}: ${yield* nameOfVenue(action.venueId)} → ${[...details, ...alias, ...active].join(', ')}`;
        }
        default: {
            return '';
        }
    }
});
