import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { person, personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Predicate from 'effect/Predicate';

import { ActionFailedError } from '../error/action-failed.error';
import { cancelReasonText, countOf, formatSessionLabel } from '../i18n/messages';
import { getSession, requireSession } from '../sessions/session.service';
import { pollFor, previewOf } from '../signups/poll-for';

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

const noVenue = {
    venueName: null,
    venueShortName: null,
    venueStation: null,
    venueAddress: null,
    venueLat: null,
    venueLng: null,
    venueMapUrl: null
};

export const displayOfVenue = Effect.fn('Core.displayOfVenue')(function* (venueId: string | null | undefined, communityId: string) {
    const db = yield* Db;

    if (!isDefined(venueId)) {
        return noVenue;
    }

    const [row] = yield* db
        .select({
            venueName: venue.name,
            venueShortName: venue.shortName,
            venueStation: venue.station,
            venueAddress: venue.address,
            venueLat: venue.lat,
            venueLng: venue.lng,
            venueMapUrl: venue.mapUrl
        })
        .from(venue)
        .where(and(eq(venue.id, venueId), eq(venue.communityId, communityId)));

    return row ?? noVenue;
});

const requireDisplay = Effect.fn('Core.requireDisplay')(function* (venueId: string | null | undefined, communityId: string) {
    const display = yield* displayOfVenue(venueId, communityId);

    return isDefined(venueId) && !isDefined(display.venueName)
        ? yield* ActionFailedError.make({ reason: 'this place is no longer available' })
        : display;
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
        forward: '📣 Відкрити опитування для',
        remove: '🗑 Видалити гру',
        self: 'тобі в особисті',
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
        alias: 'також'
    },
    ru: {
        create: '➕ Новая игра',
        announce: 'и опубликовать опрос в группе',
        update: '✏️ Изменить игру',
        cancel: '❌ Отменить игру',
        notify: 'с уведомлением в группе',
        publishPoll: '📣 Опубликовать опрос',
        forward: '📣 Открыть опрос для',
        remove: '🗑 Удалить игру',
        self: 'тебе в личку',
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
        alias: 'также'
    }
} as const;

const chatTitle = Effect.fn('Core.chatTitle')(function* (chatId: string, locale: Locale) {
    const db = yield* Db;

    if (/^\d+$/u.test(chatId)) {
        return words[locale].self;
    }

    const [row] = /^-?\d+$/u.test(chatId)
        ? yield* db
              .select({ title: telegramChat.title })
              .from(telegramChat)
              .where(eq(telegramChat.chatId, BigInt(chatId)))
        : [];

    return row?.title ?? chatId;
});

const sizeOf = (
    locale: Locale,
    { fieldsPlanned, capacityMax }: { readonly fieldsPlanned?: number | null; readonly capacityMax?: number | null }
): string[] => [
    ...(isDefined(fieldsPlanned) ? [countOf(locale, 'field', fieldsPlanned)] : []),
    ...(isDefined(capacityMax) ? [countOf(locale, 'place', capacityMax)] : [])
];

const describeCreate = Effect.fn('Core.describeCreate')(function* (
    action: Extract<Action, { _tag: 'create_session' }>,
    locale: Locale,
    communityId: string
) {
    const word = words[locale];
    const display = yield* requireDisplay(action.venueId, communityId);
    const summary = `${word.create}: ${[formatSessionLabel(locale, { ...action, ...display }), ...sizeOf(locale, action)].join(', ')}`;

    if (!action.announce) {
        return summary;
    }

    const game = { ...action, ...display, fieldsPlanned: action.fieldsPlanned ?? null };
    const poll = yield* pollFor(communityId, game, action.note);

    const where = isDefined(action.chatId) ? ` «${yield* chatTitle(action.chatId, locale)}»` : '';

    return `${summary} ${word.announce}${where}:\n\n${previewOf(poll)}`;
});

export const describeAction = Effect.fn('Core.describeAction')(function* (action: Action, locale: Locale, communityId: string) {
    const word = words[locale];

    switch (action._tag) {
        case 'create_session': {
            return yield* describeCreate(action, locale, communityId);
        }
        case 'update_session': {
            const before = yield* getSession(action.sessionId);
            const venueName = Predicate.isUndefined(action.venueId)
                ? before.pipe(
                      Option.map(value => value.venueName),
                      Option.getOrNull
                  )
                : (yield* requireDisplay(action.venueId, communityId)).venueName;
            const after = before.pipe(
                Option.map(value =>
                    formatSessionLabel(locale, {
                        localDate: action.localDate ?? value.localDate,
                        localTime: action.localTime ?? value.localTime,
                        venueName
                    })
                )
            );
            const changes = [Option.getOrElse(after, () => '?'), ...sizeOf(locale, action)].join(', ');

            return `${word.update}: ${yield* sessionLabel(locale, action.sessionId)} → ${changes}${action.notify ? ` (${word.notify})` : ''}`;
        }
        case 'cancel_session': {
            return `${word.cancel}: ${yield* sessionLabel(locale, action.sessionId)} — ${cancelReasonText(locale, action.reason)}${action.notify ? ` (${word.notify})` : ''}`;
        }
        case 'announce_session': {
            const target = yield* requireSession(communityId, action.sessionId);
            const poll = yield* pollFor(communityId, target, action.note);

            return `${word.publishPoll}: ${formatSessionLabel(locale, target)}\n\n${previewOf(poll)}`;
        }
        case 'delete_session': {
            return `${word.remove}: ${yield* sessionLabel(locale, action.sessionId)}`;
        }
        case 'forward_poll': {
            return `${word.forward} «${yield* chatTitle(action.chatId, locale)}»: ${yield* sessionLabel(locale, action.sessionId)}`;
        }
        case 'publish_teams': {
            const lines = action.teams.map(
                team => `${team.ordinal}. ${team.players.map(player => `${player.displayName}${player.isGk ? ' 🧤' : ''}`).join(', ')}`
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

            return `${word.venue}: ${[action.name, action.shortName, action.station, action.address].filter(part => isNotEmptyString(part)).join(', ')}${game}`;
        }
        case 'update_venue': {
            const { venueName } = yield* displayOfVenue(action.venueId, communityId);
            const active = isDefined(action.active) ? [action.active ? word.venueOn : word.venueOff] : [];
            const alias = isDefined(action.alias) ? [`${word.alias} «${action.alias}»`] : [];
            const details = [action.name, action.shortName, action.station, action.address, action.district, action.indoor].filter(part =>
                isDefined(part)
            );

            return `${word.venueChange}: ${venueName} → ${[...details, ...alias, ...active].join(', ')}`;
        }
        default: {
            return '';
        }
    }
});
