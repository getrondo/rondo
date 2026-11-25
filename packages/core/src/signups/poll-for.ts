import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { community } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

import { ActionFailedError } from '../error/action-failed.error';
import { resolveLocale, type Locale } from '../i18n/locale';
import { countOf, text } from '../i18n/messages';

import { placeOf, placePlain, routeOf } from './place-block';

import type { PollGame, PollText } from '../interface/poll.interface';

const questionLimit = 300;
const answerLimit = 100;

const PollTemplateSchema = Schema.Struct({
    question: Schema.String.check(Schema.isPattern(/^(?:[^{}]|\{(?:weekday|date|time|place|station|fields|places)\})+$/u)),
    answers: Schema.Tuple([Schema.NonEmptyString, Schema.NonEmptyString])
});
const decodeSettings = Schema.decodeUnknownEffect(Schema.Struct({ poll: Schema.optional(Schema.NullOr(PollTemplateSchema)) }));

const defaultTemplate = (locale: Locale): typeof PollTemplateSchema.Type => ({
    question: '⚽ {weekday}, {date}, {time} {place}, {station}\n\n{fields}, {places}',
    answers: [text(locale, 'pollIn'), text(locale, 'pollOut')]
});

const inWords = (locale: Locale, localDate: string, options: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(new Date(`${localDate}T12:00:00Z`));

const valuesOf = (locale: Locale, game: PollGame): Readonly<Record<string, string | null>> => {
    const weekday = inWords(locale, game.localDate, { weekday: 'long' });

    return {
        weekday: `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}`,
        date: inWords(locale, game.localDate, { day: 'numeric', month: 'long' }),
        time: game.localTime.replace(':', '.'),
        place: game.venueShortName ?? game.venueName,
        station: game.venueStation,
        fields: isDefined(game.fieldsPlanned) ? countOf(locale, 'field', game.fieldsPlanned) : null,
        places: isDefined(game.capacityMax) ? countOf(locale, 'place', game.capacityMax) : null
    };
};

// An unknown value disappears together with the separator beside it
const fillQuestion = (question: string, values: Readonly<Record<string, string | null>>): string =>
    question
        .replaceAll(/\{(\w+)\}/gu, (placeholder, name: string) => values[name] ?? placeholder)
        .replaceAll(/^\{\w+\}[ ,·–—-]{0,5}|[ ,·–—-]{0,5}\{\w+\}/gmu, '')
        .replaceAll(/\n{3,}/gu, '\n\n')
        .trim();

export const pollFor = Effect.fn('Core.pollFor')(function* (communityId: string, game: PollGame, note: string | null | undefined) {
    const db = yield* Db;
    const [row] = yield* db
        .select({ settings: community.settings, defaultLocale: community.defaultLocale })
        .from(community)
        .where(eq(community.id, communityId));
    const locale = resolveLocale(row?.defaultLocale);
    const settings = yield* decodeSettings(row?.settings).pipe(
        Effect.mapError(() => ActionFailedError.make({ reason: 'the poll template in the community settings is not valid' }))
    );
    const template = settings.poll ?? defaultTemplate(locale);
    const lastLine = note
        ?.split('\n')
        .map(line => line.trim().replaceAll(/\s+/gu, ' '))
        .filter(line => isNotEmptyString(line))
        .join('\n');
    const question = [fillQuestion(template.question, valuesOf(locale, game)), lastLine].filter(part => isNotEmptyString(part)).join('\n');

    if (!isNotEmptyString(question) || question.length > questionLimit) {
        return yield* ActionFailedError.make({
            reason: `the poll question has ${question.length} characters, 1 to ${questionLimit} are allowed`
        });
    }

    if (template.answers.some(answer => answer.length > answerLimit)) {
        return yield* ActionFailedError.make({ reason: `a poll answer is longer than ${answerLimit} characters` });
    }

    const place = placeOf(game);

    return { question, answers: template.answers, place, route: routeOf(place) } satisfies PollText;
});

export const previewOf = ({ question, answers, place, route }: PollText): string =>
    [
        question,
        '',
        ...answers.map(answer => `▫️ ${answer}`),
        ...(isDefined(place) ? ['', ...placePlain(place)] : []),
        ...(isDefined(route) ? [`${route.label}: ${route.url}`] : [])
    ].join('\n');
