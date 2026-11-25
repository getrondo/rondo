import { describe, expect, it } from 'vitest';

import { affinitiesOf, coloursFor, solveColoured } from '../src/teams/home-colours';

import type { BadgeColour } from '../src/teams/interface/badge.interface';
import type { ColouredRow } from '../src/teams/interface/home-colour.interface';
import type { SolverPlayer } from '../src/teams/interface/solver.interface';

const rgb: readonly BadgeColour[] = ['red', 'green', 'blue'];

const player = (id: string, strength = 25): SolverPlayer => ({
    id,
    strength,
    uncertainty: 5,
    isGk: false,
    roles: [],
    hostId: null,
    shortScore: 0
});

// One row per colour given, the newest first
const historyOf = (id: string, colours: readonly (BadgeColour | null)[]): ColouredRow[] =>
    colours.map((colour, index) => ({
        game: `g${String(index).padStart(2, '0')}`,
        date: new Date(Date.UTC(2026, 9, 1) - index * 86_400_000).toISOString().slice(0, 10),
        team: rgb.indexOf(colour ?? 'red') + 1,
        player: id,
        colour
    }));

const times = (colour: BadgeColour, count: number): BadgeColour[] => Array.from({ length: count }, () => colour);

const regulars = (entries: readonly (readonly [string, readonly (BadgeColour | null)[]])[], fixed = new Map<string, BadgeColour>()) =>
    affinitiesOf(
        entries.flatMap(([id, colours]) => historyOf(id, colours)),
        new Map(entries.map(([id]) => [id, fixed.get(id) ?? null]))
    );

const teamOf = (teams: readonly (readonly string[])[], id: string): number => teams.findIndex(team => team.includes(id));

const inputOf = (players: readonly SolverPlayer[], teamCount: number) => ({
    players,
    teamCount,
    locks: new Map<string, number>(),
    habits: new Map<string, number>(),
    recent: new Map<string, number>()
});

describe('home colours', () => {
    it('learns a strong colour from at least eight of the last twenty squads with a colour and 80% of them', () => {
        const affinities = regulars([
            ['strong', [...times('red', 4), null, ...times('red', 2), 'green', 'red', ...times('red', 1)]],
            ['seven', times('red', 7)],
            ['mixed', [...times('red', 7), ...times('green', 3)]],
            ['moved', [...times('blue', 20), ...times('red', 30)]],
            ['none', []]
        ]);
        const homes = [...affinities].map(([id, affinity]) => [id, affinity.home]);

        expect(homes).toEqual([
            ['strong', 'red'],
            ['seven', null],
            ['mixed', null],
            ['moved', 'blue'],
            ['none', null]
        ]);
        expect(affinities.get('moved')?.shares.get('red')).toBeUndefined();
        expect(affinities.get('moved')?.shares.get('blue')).toBeCloseTo(20 / 21);
        expect(affinities.get('seven')?.shares.get('red')).toBeCloseTo(7 / 8);
    });

    it('lets the colour an admin fixed win', () => {
        const fixed = regulars([['fixed', times('red', 10)]], new Map([['fixed', 'green']]));

        expect(fixed.get('fixed')).toEqual({ home: 'green', fixed: 'green', shares: new Map([['green', 20]]) });
    });

    it('takes the most frequent set of colours for the team count, then the most played colours', () => {
        const game = (colours: readonly BadgeColour[], index: number): ColouredRow[] =>
            colours.map((colour, team) => ({
                game: `${colours.join('')}${index}`,
                date: `2026-0${index}-01`,
                team: team + 1,
                player: `p${team}`,
                colour
            }));
        const rows = [
            game(['blue', 'white'], 9),
            game(['green', 'red'], 8),
            game(['red', 'green'], 7),
            game(['blue', 'green', 'red'], 6),
            game(['red', 'green', 'blue'], 5),
            game(['green', 'red'], 4)
        ].flat();

        expect(coloursFor(rows, 2)).toEqual(['red', 'green']);
        expect(coloursFor(rows, 3)).toEqual(['red', 'blue', 'green']);
        expect(coloursFor(rows, 4)).toEqual(['red', 'green', 'blue', 'white']);
        expect(coloursFor([], 2)).toEqual(['red', 'blue']);
    });

    it('gives each team the colour its players usually wear, weak habits included', () => {
        const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map(id => player(id));
        const half = (colour: BadgeColour): BadgeColour[] => [...times(colour, 5), 'white', 'white'];
        const affinities = regulars(players.map(({ id }, index) => [id, half(rgb[index % 3] ?? 'red')]));
        // Habits tie the three of one colour together, so only the colour of each team is open
        const habits = new Map(
            players.flatMap((first, left) =>
                players
                    .slice(left + 1)
                    .flatMap((second, offset) => ((offset + 1) % 3 === 0 ? [[`${first.id}|${second.id}`, 2] as const] : []))
            )
        );

        for (const colours of [rgb, ['blue', 'red', 'green'] as const, ['green', 'blue', 'red'] as const]) {
            const [best] = solveColoured({ ...inputOf(players, 3), habits }, { colours, affinities });
            const placed = best?.teams.map((team, index) => [
                colours[index],
                team.map(id => players.findIndex(entry => entry.id === id) % 3)
            ]);

            expect(placed?.map(([colour, kinds]) => [colour, kinds])).toEqual(
                colours.map(colour => [colour, times('red', 3).map(() => rgb.indexOf(colour))])
            );
        }
    });

    it('keeps a strong regular in his colour over several occasional players', () => {
        const occasional = ['a', 'b', 'c'];
        const affinities = regulars([['home', times('red', 10)], ...occasional.map(id => [id, times('green', 1)] as const)]);
        const players = ['home', ...occasional, 'w', 'x', 'y', 'z'].map(id => player(id));
        const habits = new Map(occasional.map(id => [`${id}|home`, 20] as const));
        const [best] = solveColoured({ ...inputOf(players, 2), habits, proposals: 1 }, { colours: ['red', 'green'], affinities });

        expect(best?.teams[0]?.toSorted()).toEqual(['a', 'b', 'c', 'home']);
    });

    it('never lets learned colours make «Сили рівні» into less when an even split exists', () => {
        const random = (seed: number) => {
            let current = seed % 2_147_483_647;

            return () => {
                current = (current * 48_271) % 2_147_483_647;

                return current / 2_147_483_647;
            };
        };

        for (let index = 1; index <= 150; index += 1) {
            const next = random(index * 15_485_863);
            const teamCount = 2 + (index % 3);
            const colours = [...rgb, 'yellow' as const].slice(0, teamCount);
            const offsets = colours.map(() => next() * 0.8);
            const players = Array.from({ length: teamCount * (4 + (index % 6)) }, (_, entry) =>
                player(`p${String(entry).padStart(2, '0')}`, 25 + (offsets[entry % teamCount] ?? 0) + (next() - 0.5) * 0.4 * (index % 5))
            );
            const affinities = regulars(players.map(({ id }, entry) => [id, times(colours[entry % teamCount] ?? 'red', 10)]));
            const input = { ...inputOf(players, teamCount), proposals: 1 };
            const [plain] = solveColoured(input, { colours, affinities: new Map() });
            const [coloured] = solveColoured(input, { colours, affinities });

            expect({ index, even: (coloured?.balance ?? 0) >= 0.85 }).toEqual({ index, even: (plain?.balance ?? 0) >= 0.85 });
        }
    });

    it('gives colours to five and six teams within a second', () => {
        const all: readonly BadgeColour[] = ['red', 'blue', 'green', 'yellow', 'white', 'orange'];
        const players = Array.from({ length: 36 }, (_, index) => player(`p${String(index).padStart(2, '0')}`));
        const affinities = regulars(players.map(({ id }, index) => [id, times(all[index % 6] ?? 'red', 6)]));
        const started = performance.now();
        const [five] = solveColoured({ ...inputOf(players, 5), proposals: 1 }, { colours: all.slice(0, 5), affinities });
        const [six] = solveColoured({ ...inputOf(players, 6), proposals: 1 }, { colours: all, affinities });

        expect(five?.teams.flat()).toHaveLength(36);
        expect(six?.teams.flat()).toHaveLength(36);
        expect(performance.now() - started).toBeLessThan(1000);
    });

    it('keeps strong players apart in their own colours and together in one, but never against the levels', () => {
        const homes = ['r1', 'r2', 'r3', 'g1', 'g2', 'g3'];
        const colourOf = (id: string): BadgeColour => (id.startsWith('r') ? 'red' : 'green');
        const others = Array.from({ length: 8 }, (_, index) => `x${index}`);
        const affinities = regulars([
            ...homes.map(id => [id, times(colourOf(id), 10)] as const),
            ...others.map(id => [id, [] as BadgeColour[]] as const)
        ]);
        const level = [...homes, ...others].map(id => player(id));
        const colours = ['red', 'green'] as const;
        const [easy] = solveColoured(inputOf(level, 2), { colours, affinities });
        const strongReds = [...homes, ...others].map(id => player(id, id.startsWith('r') ? 31 : 25));
        const [levelled] = solveColoured(inputOf(strongReds, 2), { colours, affinities });
        const reds = levelled?.teams.map(team => team.filter(id => id.startsWith('r')).length);

        expect(homes.map(id => teamOf(easy?.teams ?? [], id))).toEqual([0, 0, 0, 1, 1, 1]);
        expect(reds?.toSorted()).toEqual([1, 2]);
    });

    it('places a newcomer into his colour without moving the others and follows no colour against a lock', () => {
        const players = Array.from({ length: 12 }, (_, index) => player(`m${String(index).padStart(2, '0')}`));
        const anchor = [players.slice(0, 6), players.slice(6)].map(team => team.map(entry => entry.id));
        const affinities = regulars([['late', times('green', 10)]]);
        const place = (colours: readonly BadgeColour[], locks = new Map<string, number>()) =>
            solveColoured({ ...inputOf([...players, player('late')], 2), anchor, locks }, { colours, affinities })[0];

        expect(teamOf(place(['red', 'green'])?.teams ?? [], 'late')).toBe(1);
        expect(teamOf(place(['green', 'red'])?.teams ?? [], 'late')).toBe(0);
        expect(place(['red', 'green'])?.moves).toBe(0);
        expect(teamOf(place(['red', 'green'], new Map([['late', 0]]))?.teams ?? [], 'late')).toBe(0);
    });

    it('follows the colour an admin fixed against every habit of playing together', () => {
        const ids = Array.from({ length: 12 }, (_, index) => `p${String(index).padStart(2, '0')}`);
        const levels = [...ids.map(id => player(id)).slice(0, 11), player('p11', 25.1)];
        const affinities = regulars(
            ids.map((id, index) => [id, times(index % 2 === 0 ? 'red' : 'green', 10)]),
            new Map([['p00', 'green']])
        );
        const habits = new Map(
            ids.flatMap((first, left) =>
                ids.slice(left + 1).map((second, offset) => [`${first}|${second}`, offset % 2 === 1 ? 3 : -3] as const)
            )
        );

        for (const players of [ids.map(id => player(id)), levels]) {
            const proposals = solveColoured({ ...inputOf(players, 2), habits }, { colours: ['red', 'green'], affinities });

            expect(teamOf(proposals.find(({ reason }) => reason === 'usual')?.teams ?? [], 'p00')).toBe(1);
        }
    });

    it('never moves locked players to another team for the colours and answers the same in any order', () => {
        const players = Array.from({ length: 12 }, (_, index) => player(`p${String(index).padStart(2, '0')}`, 20 + (index % 4)));
        const affinities = regulars(players.map(({ id }, index) => [id, times(index % 2 === 0 ? 'red' : 'green', 10)]));
        const locks = new Map(players.slice(0, 8).map(({ id }, index) => [id, index % 2 === 0 ? 1 : 0]));
        const context = { colours: ['red', 'green'] as const, affinities };
        const proposals = solveColoured({ ...inputOf(players, 2), locks }, context);
        const anchor = [1, 0].map(team => players.filter((_player, index) => index % 2 === team).map(({ id }) => id));
        const level = players.map(({ id }) => player(id));
        const [anchored] = solveColoured({ ...inputOf(level, 2), anchor }, context);
        const free = solveColoured(inputOf(players, 2), context);
        const reversed = solveColoured(inputOf(players.toReversed(), 2), context);
        const sets = (result: typeof free) => result.map(proposal => proposal.teams.map(team => team.toSorted()));

        expect(proposals.map(({ teams }) => [...locks.keys()].map(id => teamOf(teams, id)))).toEqual(
            Array.from({ length: 3 }, () => [...locks.values()])
        );
        expect(anchored?.teams.map(team => team.toSorted())).toEqual(anchor);
        expect(sets(reversed)).toEqual(sets(free));
    });
});
