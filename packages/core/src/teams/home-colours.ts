import { isDefined } from '@rnw-community/shared';

import { badges, defaultColours } from './badges';
import { solveTeams } from './solve-teams';

import type { BadgeColour } from './interface/badge.interface';
import type { Affinity, ColouredRow } from './interface/home-colour.interface';
import type { Proposal, SolverInput } from './interface/solver.interface';

const recentSquads = 20;
const recentGames = 50;
const smoothing = 1;
const strongSquads = 8;
const strongShare = 0.8;
const homeFit = 2;
// One player fixed by an admin decides who wears which before the shares of a whole team do
const fixedShare = 20;

const countsOf = <Value>(values: readonly Value[]): (readonly [Value, number])[] => {
    const counts = new Map<Value, number>();

    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return [...counts].toSorted((left, right) => right[1] - left[1]);
};

const newestFirst = (rows: readonly ColouredRow[]): ColouredRow[] =>
    rows.toSorted((left, right) => right.date.localeCompare(left.date) || left.game.localeCompare(right.game) || left.team - right.team);

const affinityOf = (colours: readonly BadgeColour[], fixed: BadgeColour | null): Affinity => {
    if (isDefined(fixed)) {
        return { shares: new Map([[fixed, fixedShare]]), home: fixed, fixed };
    }

    const counts = countsOf(colours);
    const [favourite, count] = counts[0] ?? [null, 0];

    return {
        shares: new Map(counts.map(([colour, games]) => [colour, games / (colours.length + smoothing)])),
        home: colours.length >= strongSquads && count / colours.length >= strongShare ? favourite : null,
        fixed
    };
};

export const affinitiesOf = (rows: readonly ColouredRow[], players: ReadonlyMap<string, BadgeColour | null>): Map<string, Affinity> => {
    const recent = newestFirst(rows);

    return new Map(
        [...players].map(([id, fixed]) => [
            id,
            affinityOf(
                recent.flatMap(row => (row.player === id && isDefined(row.colour) ? [row.colour] : [])).slice(0, recentSquads),
                fixed
            )
        ])
    );
};

const order = badges.map(entry => entry.colour);

export const coloursFor = (rows: readonly ColouredRow[], count: number): BadgeColour[] => {
    const games = new Map<string, Map<number, BadgeColour | null>>();

    for (const row of newestFirst(rows)) {
        games.set(row.game, (games.get(row.game) ?? new Map<number, BadgeColour | null>()).set(row.team, row.colour));
    }

    const worn = Array.from(games.values(), teams => ({
        size: teams.size,
        colours: new Set([...teams.values()].filter(colour => isDefined(colour)))
    }));
    const sets = worn
        .filter(({ size, colours }) => size === count && colours.size === count)
        .slice(0, recentGames)
        .map(({ colours }) => order.filter(colour => colours.has(colour)));
    const [usual] = countsOf(sets.map(colours => colours.join(',')));
    const ranked = countsOf(worn.slice(0, recentGames).flatMap(({ colours }) => order.filter(colour => colours.has(colour)))).map(
        ([colour]) => colour
    );

    return defaultColours(count, sets.find(colours => colours.join(',') === usual?.[0]) ?? ranked);
};

const permutations = (items: readonly number[], taken: readonly number[] = []): (readonly number[])[] =>
    taken.length === items.length
        ? [taken]
        : items.filter(item => !taken.includes(item)).flatMap(item => permutations(items, [...taken, item]));

interface ColourContext {
    readonly colours: readonly string[];
    readonly affinities: ReadonlyMap<string, Affinity>;
}

export const arranged = (teams: Proposal['teams'], { colours, affinities }: ColourContext): Proposal['teams'] => {
    const fit = teams.map(members =>
        colours.map(colour =>
            members.reduce((sum, id) => {
                const affinity = affinities.get(id);

                return sum + (affinity?.shares.get(colour) ?? 0) * (affinity?.home === colour ? homeFit : 1);
            }, 0)
        )
    );
    let best: readonly number[] = teams.map((_members, team) => team);
    let bestFit = -Infinity;

    // At most six teams have a badge of their own, so 720 orders
    for (const candidate of teams.length <= badges.length ? permutations(best) : []) {
        const total = candidate.reduce((sum, team, colour) => sum + (fit[team]?.[colour] ?? 0), 0);

        if (total > bestFit + 1e-9) {
            best = candidate;
            bestFit = total;
        }
    }

    return best.map(team => teams[team] ?? []);
};

// Teams come in the order of the colours: the first one wears the first colour
export const solveColoured = (input: Omit<SolverInput, 'homes'>, context: ColourContext): Proposal[] => {
    const homes = new Map(
        [...context.affinities].flatMap(([id, { home, fixed }]) => {
            const team = isDefined(home) ? context.colours.indexOf(home) : -1;

            return team >= 0 && team < input.teamCount ? [[id, { team, isFixed: isDefined(fixed) }] as const] : [];
        })
    );
    const isOpen = !isDefined(input.anchor) && input.locks.size === 0;

    const proposals = solveTeams({ ...input, homes });

    return isOpen ? proposals.map(proposal => Object.assign(proposal, { teams: arranged(proposal.teams, context) })) : proposals;
};
