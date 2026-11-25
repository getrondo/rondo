import { isDefined } from '@rnw-community/shared';
import * as Schema from 'effect/Schema';

const Teams = Schema.Array(Schema.Array(Schema.String));

const SnapshotSchema = Schema.Struct({
    teams: Teams,
    colours: Schema.Array(Schema.String),
    locks: Schema.Array(Schema.String),
    keepers: Schema.Array(Schema.String),
    pending: Schema.Array(Schema.String)
});

export const DraftStateSchema = Schema.Struct({
    ...SnapshotSchema.fields,
    variants: Schema.Array(Teams),
    reasons: Schema.Array(Schema.String),
    variant: Schema.Int,
    history: Schema.Array(SnapshotSchema),
    joined: Schema.Array(Schema.String),
    left: Schema.Array(Schema.String),
    lastTap: Schema.NullOr(Schema.String)
});

export type DraftState = typeof DraftStateSchema.Type;
type Snapshot = typeof SnapshotSchema.Type;

const historyLimit = 5;

const snapshotOf = (state: DraftState): Snapshot => ({
    teams: state.teams,
    colours: state.colours,
    locks: state.locks,
    keepers: state.keepers,
    pending: state.pending
});

export const withChange = (state: DraftState, change: Partial<Snapshot>, variant = -1): DraftState => ({
    ...state,
    ...change,
    variant,
    history: [snapshotOf(state), ...state.history].slice(0, historyLimit)
});

export const playersOf = (state: DraftState): string[] => [...state.teams.flat(), ...state.pending];

export const teamIndexOf = (state: DraftState, personId: string): number => state.teams.findIndex(team => team.includes(personId));

const without = (teams: DraftState['teams'], personIds: readonly string[]): string[][] =>
    teams.map(team => team.filter(member => !personIds.includes(member)));

const swapped = (member: string, first: string, second: string): string => {
    if (member === first) {
        return second;
    }

    return member === second ? first : member;
};

export const swapPlayers = (state: DraftState, first: string, second: string): DraftState =>
    withChange(state, { teams: state.teams.map(team => team.map(member => swapped(member, first, second))) });

export const movePlayers = (state: DraftState, personIds: readonly string[], team: number): DraftState => {
    const teams = without(state.teams, personIds);

    return withChange(state, {
        teams: teams.map((members, index) => (index === team ? [members, personIds].flat() : members)),
        pending: state.pending.filter(member => !personIds.includes(member))
    });
};

const toggle = (values: readonly string[], value: string): string[] =>
    values.includes(value) ? values.filter(entry => entry !== value) : [...values, value];

export const toggleLock = (state: DraftState, personId: string): DraftState =>
    withChange(state, { locks: toggle(state.locks, personId) }, state.variant);

export const toggleKeeper = (state: DraftState, personId: string): DraftState =>
    withChange(state, { keepers: toggle(state.keepers, personId) }, state.variant);

export const setColour = (state: DraftState, team: number, colour: string): DraftState => {
    const holder = state.colours.indexOf(colour);
    const current = state.colours[team] ?? colour;
    const colourAt = (index: number, entry: string): string => {
        if (index === team) {
            return colour;
        }

        return index === holder ? current : entry;
    };

    return withChange(state, { colours: state.colours.map((entry, index) => colourAt(index, entry)) }, state.variant);
};

export const undo = (state: DraftState): DraftState => {
    const [previous, ...rest] = state.history;

    return isDefined(previous) ? { ...state, ...previous, history: rest, variant: -1 } : state;
};

export const pickVariant = (state: DraftState, variant: number): DraftState => {
    const teams = state.variants[variant];

    if (!isDefined(teams)) {
        return state;
    }

    const free = teams.map(members => members.filter(personId => !state.locks.includes(personId)));

    for (const personId of state.locks) {
        free[teamIndexOf(state, personId)]?.push(personId);
    }

    return withChange(state, { teams: free, pending: [] }, variant);
};

export const syncRoster = (state: DraftState, roster: readonly string[]): DraftState => {
    const placed = playersOf(state);
    const left = placed.filter(personId => !roster.includes(personId));
    const joined = roster.filter(personId => !placed.includes(personId));

    if (left.length + joined.length === 0) {
        return state;
    }

    return {
        ...state,
        teams: without(state.teams, left),
        pending: [...state.pending.filter(personId => !left.includes(personId)), ...joined],
        locks: state.locks.filter(personId => !left.includes(personId)),
        joined: [...state.joined.filter(personId => !left.includes(personId)), ...joined],
        left: [...state.left.filter(personId => !joined.includes(personId)), ...left.filter(personId => !state.joined.includes(personId))],
        variant: -1
    };
};

export const syncByAdmin = (state: DraftState, roster: readonly string[]): DraftState => {
    const synced = syncRoster(state, roster);

    return synced === state ? state : { ...synced, joined: state.joined.filter(personId => roster.includes(personId)), left: state.left };
};

export const initialState = (input: {
    readonly variants: DraftState['variants'];
    readonly reasons: readonly string[];
    readonly colours: readonly string[];
    readonly keepers: readonly string[];
}): DraftState => ({
    teams: input.variants[0] ?? [],
    colours: input.colours,
    locks: [],
    keepers: input.keepers,
    pending: [],
    variants: input.variants,
    reasons: input.reasons,
    variant: 0,
    history: [],
    joined: [],
    left: [],
    lastTap: null
});
