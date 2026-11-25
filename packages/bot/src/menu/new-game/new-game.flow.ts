import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { predictGames, sizeAt, sizeOfPlace } from '@rondo/core/menu/game-suggestions';

import { fromShortId } from '../../utils/from-short-id.util';

import { destinationChoices } from './audience';
import { emptyDraft, type Draft, type DraftView, type NewGameData } from './draft';

import type { GameCandidate } from '@rondo/core/menu/past-game.interface';

const awaitingByView: Partial<Record<DraftView, string>> = {
    main: 'preview',
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

const fromCandidate = (candidate: GameCandidate, data: NewGameData, kept: Draft | null): Draft => {
    const linked = candidate.audience.filter(chatId => data.chats.some(chat => chat.id === chatId));
    const remembered = data.lastChatId === data.selfChatId ? [data.selfChatId] : linked;
    const audience = isDefined(kept) && isNotEmptyArray(kept.audience) ? kept.audience : remembered;
    const size = isDefined(kept) && kept.custom ? { fields: kept.fields, places: kept.places, custom: true } : {};

    return candidate._tag === 'new'
        ? {
              ...emptyDraft,
              localDate: candidate.localDate,
              localTime: candidate.localTime,
              venueId: candidate.venueId,
              fields: candidate.fields,
              places: candidate.places,
              sized: true,
              audience,
              ...size
          }
        : { ...emptyDraft, localDate: candidate.localDate, sessionId: candidate.sessionId, audience };
};

export const startDraft = (data: NewGameData): Draft => {
    const [first] = candidatesOf(data);

    return isDefined(first) ? fromCandidate(first, data, null) : { ...emptyDraft, manual: true, view: 'day', notice: 'tooLittle' };
};

const isComplete = (draft: Draft): boolean =>
    isDefined(draft.localDate) && isDefined(draft.venueId) && isDefined(draft.localTime) && draft.sized;

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

export const advance = (draft: Draft): Draft => ({ ...draft, view: nextView(draft), notice: null, summary: null });

const previousView = (draft: Draft): DraftView => {
    if (draft.view === 'venues' || draft.view === 'venue_name') {
        return 'place';
    }

    if (!draft.manual || isComplete(draft)) {
        return 'main';
    }

    const order: DraftView[] = ['day', 'place', 'time', 'size', 'main'];
    const position = order.indexOf(draft.view);

    return position > 0 ? (order[position - 1] ?? 'day') : 'day';
};

const back = (draft: Draft): Draft => {
    if (draft.view === 'map' || draft.view === 'address') {
        return advance(draft);
    }

    if (draft.manual && draft.view === 'day' && isDefined(draft.restore)) {
        return { ...draft, ...draft.restore, manual: false, restore: null, view: 'main', notice: null, summary: null };
    }

    return { ...draft, view: previousView(draft), notice: null };
};

export const isPastToday = (data: NewGameData, localDate: string | null, localTime: string | null) =>
    localDate === data.today && isDefined(localTime) && localTime <= data.nowTime;

export const withVenue = (draft: Draft, venueId: string, data: NewGameData, view: DraftView | null): Draft => {
    const size = sizeOfPlace(data.history, venueId);
    const resized = draft.manual || draft.custom ? {} : { fields: size.fields ?? draft.fields, places: size.places ?? draft.places };
    const next = { ...draft, venueId, ...resized };

    return isDefined(view) ? { ...next, view, notice: null, summary: null } : advance(next);
};

export const withPlaces = (draft: Draft, places: number | null): Draft => advance({ ...draft, places, sized: true, custom: true });

export const placesOf = (draft: Draft, data: NewGameData): number =>
    draft.places ?? sizeAt(data.history, draft.venueId, draft.localDate ?? data.today).places ?? 14;

const stepPlaces = (draft: Draft, data: NewGameData, step: number): Draft => {
    const places = Math.min(99, Math.max(1, placesOf(draft, data) + step));

    return { ...draft, places, sized: true, custom: true, summary: null, notice: null };
};

const compact = (value: string): string => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

const restoreOf = (draft: Draft): Draft['restore'] => ({
    localDate: draft.localDate,
    localTime: draft.localTime,
    venueId: draft.venueId,
    fields: draft.fields,
    places: draft.places,
    sized: draft.sized,
    custom: draft.custom,
    note: draft.note,
    sessionId: draft.sessionId
});

const ops: Readonly<Record<string, (draft: Draft, arg: string, data: NewGameData) => Draft>> = {
    a: (draft, arg, data) => {
        const picked = candidatesOf(data).find(candidate => candidate.localDate === compact(arg));

        return isDefined(picked) ? fromCandidate(picked, data, draft) : draft;
    },
    'p-': (draft, _arg, data) => stepPlaces(draft, data, -1),
    'p+': (draft, _arg, data) => stepPlaces(draft, data, 1),
    pz: draft => ({ ...draft, view: 'size', notice: null }),
    ps: (draft, arg) => withPlaces(draft, arg === '0' ? null : Number(arg)),
    pf: (draft, arg) => ({ ...draft, fields: Number(arg), custom: true, summary: null }),
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
    m: draft => ({ ...emptyDraft, manual: true, view: 'day', audience: draft.audience, restore: restoreOf(draft) }),
    au: draft => ({ ...draft, view: 'dest', notice: null }),
    to: (draft, arg, data) => {
        const choice = destinationChoices(data).find(entry => entry.key === arg);

        return isDefined(choice) ? { ...draft, audience: choice.audience, view: 'main', notice: null, summary: null } : draft;
    },
    ad: draft => ({ ...draft, view: 'address', notice: null }),
    nt: draft => ({ ...draft, view: 'note', notice: null }),
    nn: draft => advance({ ...draft, note: null }),
    b: draft => back(draft)
};

export const applyOp = (draft: Draft, op: string, arg: string, data: NewGameData): Draft => {
    const apply = ops[op];

    return isDefined(apply) ? apply(draft, arg, data) : draft;
};
