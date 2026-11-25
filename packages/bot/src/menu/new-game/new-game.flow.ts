import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { predictGames, sizeAt, sizeOfPlace } from '@rondo/core/menu/game-suggestions';

import { fromShortId } from '../../utils/from-short-id.util';
import { parseDate } from '../../utils/parse-date.util';
import { parseTime } from '../../utils/parse-time.util';

import { emptyDraft, type Draft, type DraftView, type NewGameData } from './draft';

import type { MenuKey } from '../menu-text';
import type { GameCandidate } from '@rondo/core/menu/past-game.interface';

export type TypedOutcome =
    | { readonly _tag: 'draft'; readonly draft: Draft }
    | { readonly _tag: 'invalid'; readonly notice: MenuKey }
    | { readonly _tag: 'pass' };

const awaitingByView: Partial<Record<DraftView, string>> = {
    day: 'date',
    time: 'time',
    size: 'places',
    note: 'note',
    venue_name: 'venue_name',
    map: 'venue_map',
    address: 'venue_map'
};

export const awaitingOf = (draft: Draft): string | null => awaitingByView[draft.view] ?? null;

export const candidatesOf = (data: NewGameData): GameCandidate[] => predictGames(data.history, data.planned, data.today);

const fromCandidate = (candidate: GameCandidate, data: NewGameData): Draft => {
    const audience = candidate.audience.filter(chatId => data.chats.some(chat => chat.id === chatId));

    return candidate._tag === 'new'
        ? {
              ...emptyDraft,
              localDate: candidate.localDate,
              localTime: candidate.localTime,
              venueId: candidate.venueId,
              fields: candidate.fields,
              places: candidate.places,
              sized: true,
              audience
          }
        : { ...emptyDraft, localDate: candidate.localDate, sessionId: candidate.sessionId, audience };
};

const audienceChoices = (data: NewGameData): string[][] =>
    data.chats.length > 1 ? [...data.chats.map(chat => [chat.id]), data.chats.map(chat => chat.id)] : [];

export const audienceOfDraft = (draft: Draft, data: NewGameData): readonly string[] =>
    isNotEmptyArray(draft.audience) ? draft.audience : data.chats.slice(0, 1).map(chat => chat.id);

const nextAudience = (draft: Draft, data: NewGameData): Draft => {
    const choices = audienceChoices(data);
    const current = audienceOfDraft(draft, data).join(',');
    const position = choices.findIndex(choice => choice.join(',') === current);

    return { ...draft, audience: choices[(position + 1) % choices.length] ?? [], summary: null, notice: null };
};

export const startDraft = (data: NewGameData): Draft => {
    const [first] = candidatesOf(data);

    return isDefined(first) ? fromCandidate(first, data) : { ...emptyDraft, manual: true, view: 'day', notice: 'tooLittle' };
};

const nextView = (draft: Draft): DraftView => {
    if (!draft.manual) {
        return 'main';
    }

    const missing: [boolean, DraftView][] = [
        [isDefined(draft.localDate), 'day'],
        [isDefined(draft.venueId), 'place'],
        [isDefined(draft.localTime), 'time'],
        [draft.sized, 'size']
    ];

    return missing.find(([done]) => !done)?.[1] ?? 'main';
};

const advance = (draft: Draft): Draft => ({ ...draft, view: nextView(draft), notice: null, summary: null });

const previousView = (draft: Draft): DraftView => {
    if (draft.view === 'venues' || draft.view === 'venue_name') {
        return 'place';
    }

    if (!draft.manual) {
        return 'main';
    }

    const order: DraftView[] = ['day', 'place', 'time', 'size', 'main'];
    const position = order.indexOf(draft.view);

    return position > 0 ? (order[position - 1] ?? 'day') : 'day';
};

const isPastToday = (data: NewGameData, localDate: string | null, localTime: string | null) =>
    localDate === data.today && isDefined(localTime) && localTime <= data.nowTime;

export const withVenue = (draft: Draft, venueId: string, data: NewGameData, view: DraftView | null): Draft => {
    const size = sizeOfPlace(data.history, venueId);
    const resized = draft.manual ? {} : { fields: size.fields ?? draft.fields, places: size.places ?? draft.places };
    const next = { ...draft, venueId, ...resized };

    return isDefined(view) ? { ...next, view, notice: null, summary: null } : advance(next);
};

const withPlaces = (draft: Draft, places: number | null): Draft => advance({ ...draft, places, sized: true });

const stepPlaces = (draft: Draft, data: NewGameData, step: number): Draft => {
    const usual = sizeAt(data.history, draft.venueId, draft.localDate ?? data.today).places ?? 14;

    return { ...draft, places: Math.min(99, Math.max(1, (draft.places ?? usual) + step)), sized: true, summary: null, notice: null };
};

const compact = (value: string): string => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

const ops: Readonly<Record<string, (draft: Draft, arg: string, data: NewGameData) => Draft>> = {
    a: (draft, arg, data) => {
        const picked = candidatesOf(data).find(candidate => candidate.localDate === compact(arg));

        return isDefined(picked) ? fromCandidate(picked, data) : draft;
    },
    'p-': (draft, _arg, data) => stepPlaces(draft, data, -1),
    'p+': (draft, _arg, data) => stepPlaces(draft, data, 1),
    pz: draft => ({ ...draft, view: 'size', notice: null }),
    ps: (draft, arg) => withPlaces(draft, arg === '0' ? null : Number(arg)),
    pf: (draft, arg) => ({ ...draft, fields: Number(arg), summary: null }),
    t: draft => ({ ...draft, view: 'time', notice: null }),
    ts: (draft, arg, data) => {
        const localTime = `${arg.slice(0, 2)}:${arg.slice(2, 4)}`;

        return isPastToday(data, draft.localDate, localTime) ? { ...draft, notice: 'pastTime' } : advance({ ...draft, localTime });
    },
    v: draft => ({ ...draft, view: 'place', page: 0, notice: null }),
    vl: (draft, arg) => ({ ...draft, view: 'venues', page: Number(arg), notice: null }),
    vs: (draft, arg, data) => {
        const venueId = fromShortId(arg);

        return isDefined(venueId) ? withVenue(draft, venueId, data, null) : draft;
    },
    vn: draft => ({ ...draft, view: 'venue_name', notice: null }),
    ms: draft => advance(draft),
    d: draft => ({ ...draft, view: 'day', notice: null }),
    ds: (draft, arg, data) =>
        isPastToday(data, compact(arg), draft.localTime)
            ? { ...draft, notice: 'pastTime' }
            : advance({ ...draft, localDate: compact(arg) }),
    m: draft => ({ ...emptyDraft, manual: true, view: 'day', audience: draft.audience }),
    au: (draft, _arg, data) => nextAudience(draft, data),
    ad: draft => ({ ...draft, view: 'address', notice: null }),
    nt: draft => ({ ...draft, view: 'note', notice: null }),
    nn: draft => advance({ ...draft, note: null }),
    b: draft => ({ ...draft, view: previousView(draft), notice: null })
};

export const applyOp = (draft: Draft, op: string, arg: string, data: NewGameData): Draft => {
    const apply = ops[op];

    return isDefined(apply) ? apply(draft, arg, data) : draft;
};

const typedDate = (draft: Draft, text: string, data: NewGameData): TypedOutcome => {
    const parsed = parseDate(text, data.today);

    switch (parsed._tag) {
        case 'date': {
            return isPastToday(data, parsed.value, draft.localTime)
                ? { _tag: 'invalid', notice: 'pastTime' }
                : { _tag: 'draft', draft: advance({ ...draft, localDate: parsed.value }) };
        }
        case 'past': {
            return { _tag: 'invalid', notice: 'pastDate' };
        }
        case 'bad': {
            return { _tag: 'invalid', notice: 'badDate' };
        }
        case 'other': {
            return { _tag: 'pass' };
        }
        default: {
            return { _tag: 'pass' };
        }
    }
};

const typedTime = (draft: Draft, text: string, data: NewGameData): TypedOutcome => {
    const parsed = parseTime(text);

    if (parsed._tag === 'other') {
        return { _tag: 'pass' };
    }

    if (parsed._tag === 'bad') {
        return { _tag: 'invalid', notice: 'badTime' };
    }

    return isPastToday(data, draft.localDate, parsed.value)
        ? { _tag: 'invalid', notice: 'pastTime' }
        : { _tag: 'draft', draft: advance({ ...draft, localTime: parsed.value }) };
};

const typedPlaces = (draft: Draft, text: string): TypedOutcome => {
    const value = text.trim();

    if (!/^\d+$/u.test(value)) {
        return { _tag: 'pass' };
    }

    const places = Number(value);

    return places >= 1 && places <= 99 ? { _tag: 'draft', draft: withPlaces(draft, places) } : { _tag: 'invalid', notice: 'badPlaces' };
};

const typedBy: Partial<Record<DraftView, (draft: Draft, text: string, data: NewGameData) => TypedOutcome>> = {
    day: typedDate,
    time: typedTime,
    size: (draft, text) => typedPlaces(draft, text),
    note: (draft, text) => ({ _tag: 'draft', draft: advance({ ...draft, note: text.trim().replaceAll(/\s+/gu, ' ') }) })
};

export const applyText = (draft: Draft, text: string, data: NewGameData): TypedOutcome =>
    typedBy[draft.view]?.(draft, text, data) ?? { _tag: 'pass' };
