import { describe, expect, it } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { addDays } from '@rondo/core/utils/add-days.util';

import { applyOp, startDraft, withVenue } from '../src/menu/new-game/new-game.flow';
import { newGameKeyboard } from '../src/menu/new-game/new-game.keyboard';
import { applyText } from '../src/menu/new-game/typed-input';
import { toShortId } from '../src/utils/to-short-id.util';

import { syntheticSeason, type SeasonGame } from './support/season-model';

import type { Draft, NewGameData, VenueChoice } from '../src/menu/new-game/draft';

interface Effort {
    readonly taps: number;
    readonly typed: number;
    readonly changed: number;
}

const venueIds: Readonly<Record<string, string>> = {
    arena: '019ab2c3-0000-7000-8000-000000000001',
    park: '019ab2c3-0000-7000-8000-000000000002',
    lake: '019ab2c3-0000-7000-8000-000000000003',
    hill: '019ab2c3-0000-7000-8000-000000000004'
};

const named = (id: string): VenueChoice => ({ id, name: `${id.slice(0, 8)} Field`, label: id.slice(0, 8), located: true });

const buttonsOf = (draft: Draft, data: NewGameData) =>
    newGameKeyboard(draft, data, 'uk', 0)
        .flat()
        .map(button => {
            const [, , op = '', arg = ''] = button.callback_data.split(':');

            return { op, arg };
        });

const has = (draft: Draft, data: NewGameData, op: string, arg: string) =>
    buttonsOf(draft, data).some(button => button.op === op && button.arg === arg);

const compact = (value: string) => value.replaceAll('-', '');

const planGame = (target: SeasonGame, data: NewGameData): Effort => {
    let draft = startDraft(data);
    let taps = 1;
    let typed = 0;
    const tap = (op: string, arg = '') => {
        draft = applyOp(draft, op, arg, data);
        taps += 1;
    };
    const type = (text: string) => {
        const outcome = applyText(draft, text, data);
        draft = outcome._tag === 'draft' ? outcome.draft : draft;
        taps += 1;
        typed += text.length;
    };
    const differs = () => [
        draft.localDate !== target.localDate,
        draft.venueId !== target.venueId,
        draft.localTime !== target.localTime,
        draft.places !== target.capacityMax
    ];
    const changed = differs().filter(Boolean).length;
    const alternative = buttonsOf(draft, data).find(button => button.op === 'a');

    if (isDefined(alternative) && alternative.arg === compact(target.localDate)) {
        const swapped = applyOp(draft, 'a', alternative.arg, data);

        if (swapped.venueId === target.venueId && swapped.localTime === target.localTime) {
            tap('a', alternative.arg);
        }
    }

    if (draft.localDate !== target.localDate) {
        tap('d');

        if (has(draft, data, 'ds', compact(target.localDate))) {
            tap('ds', compact(target.localDate));
        } else {
            type(`${Number(target.localDate.slice(8))}.${Number(target.localDate.slice(5, 7))}`);
        }
    }

    if (draft.venueId !== target.venueId) {
        const venueId = target.venueId ?? '';
        tap('v');

        if (has(draft, data, 'vs', toShortId(venueId))) {
            tap('vs', toShortId(venueId));
        } else if (data.venues.some(venue => venue.id === venueId)) {
            tap('vl', '0');
            tap('vs', toShortId(venueId));
        } else {
            tap('vn');
            draft = withVenue(draft, venueId, { ...data, venues: [...data.venues, named(venueId)] }, 'map');
            taps += 1;
            typed += named(venueId).name.length;

            if (draft.view === 'map') {
                tap('ms');
            }
        }
    }

    if (draft.localTime !== target.localTime) {
        tap('t');

        if (has(draft, data, 'ts', target.localTime.replace(':', ''))) {
            tap('ts', target.localTime.replace(':', ''));
        } else {
            type(target.localTime.replace(':', ''));
        }
    }

    const gap = (target.capacityMax ?? 0) - (draft.places ?? 0);

    if (gap !== 0 && Math.abs(gap) <= 2) {
        Array.from({ length: Math.abs(gap) }, () => tap(gap > 0 ? 'p+' : 'p-'));
    } else if (gap !== 0) {
        tap('pz');
        type(String(target.capacityMax));
    }

    tap('ok');

    return { taps, typed, changed };
};

const simulate = () => {
    const season = syntheticSeason();

    return season.map((game, index) => {
        const today = addDays(game.localDate, -1);
        const history = season.slice(0, index).filter(earlier => earlier.localDate < today);
        const used = new Set(history.map(earlier => earlier.venueId ?? ''));
        const data: NewGameData = {
            history,
            planned: [],
            venues: [venueIds.arena ?? '', venueIds.park ?? '', venueIds.lake ?? '', ...used]
                .filter((id, position, all) => all.indexOf(id) === position)
                .map(id => named(id)),
            today,
            nowTime: '12:00',
            hasGroup: true,
            chats: [{ id: '-1', title: 'Main', topicId: null }],
            selfChatId: '1',
            lastChatId: null,
            typingHint: false
        };

        return { game, effort: planGame(game, data), warm: history.length >= 4 };
    });
};

describe('a synthetic season through the /newgame screens', () => {
    const results = simulate().filter(result => result.warm);

    it('posts a usual game in two taps', () => {
        const usual = results.filter(result => result.effort.changed === 0);

        expect(usual.every(result => result.effort.taps === 2 && result.effort.typed === 0)).toBe(true);
        expect(usual.length).toBeGreaterThan(results.length * 0.7);
    });

    it('needs at most four taps for one changed value and six for a new place', () => {
        const oneChange = results.filter(result => result.effort.changed === 1 && result.game.kind !== 'new-place');
        const newPlace = results.filter(result => result.game.kind === 'new-place');

        expect(oneChange.filter(result => result.effort.taps > 4).map(result => result.game)).toEqual([]);
        expect(newPlace.map(result => result.effort)).toEqual([{ taps: 6, typed: 14, changed: 1 }]);
    });

    it('reports the effort per kind of game', () => {
        const summary = Object.fromEntries(
            ['usual', 'one-off', 'new-place'].map(kind => {
                const games = results.filter(result => result.game.kind === kind);
                const taps = games.map(result => result.effort.taps);

                const byTaps = Object.fromEntries(
                    [...new Set(taps)]
                        .toSorted((left, right) => left - right)
                        .map(count => [count, taps.filter(value => value === count).length])
                );

                return [kind, { games: games.length, byTaps, typed: games.reduce((sum, result) => sum + result.effort.typed, 0) }];
            })
        );

        expect(summary).toMatchInlineSnapshot(`
          {
            "new-place": {
              "byTaps": {
                "6": 1,
              },
              "games": 1,
              "typed": 14,
            },
            "one-off": {
              "byTaps": {
                "10": 1,
                "8": 4,
              },
              "games": 5,
              "typed": 0,
            },
            "usual": {
              "byTaps": {
                "2": 61,
                "3": 9,
                "4": 11,
              },
              "games": 81,
              "typed": 0,
            },
          }
        `);
    });
});
