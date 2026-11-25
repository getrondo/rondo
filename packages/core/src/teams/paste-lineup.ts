import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { person, personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { membership } from '@rondo/db/schema/org.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

import { extractLineup } from '../extract/extract-lineup';
import { makeVenueMatcher } from '../extract/extract-poll';
import { normalizeAlias } from '../extract/normalize';
import { addGuests, guestsOf, joinGame } from '../signups/roster.service';

import { badgeOfEmoji } from './badges';

const PasteMemberSchema = Schema.Struct({
    name: Schema.String,
    personId: Schema.NullOr(Schema.String),
    candidates: Schema.Array(Schema.Struct({ personId: Schema.String, label: Schema.String })),
    guests: Schema.Int,
    hostName: Schema.NullOr(Schema.String),
    isGk: Schema.Boolean,
    isGuest: Schema.Boolean
});

export const PasteSchema = Schema.Struct({
    revision: Schema.Int,
    teams: Schema.Array(Schema.Struct({ colour: Schema.NullOr(Schema.String), members: Schema.Array(PasteMemberSchema) }))
});

export type Paste = typeof PasteSchema.Type;
type PasteMember = typeof PasteMemberSchema.Type;

const keyword = /склад|состав/iu;

export const isSameName = (left: string, right: string): boolean => normalizeAlias(left) === normalizeAlias(right);

const emptyConfig = {
    slug: '',
    name: '',
    timeZone: 'Europe/Vienna',
    organizers: [],
    selfAliases: [],
    venues: [],
    teamColors: [],
    squads: []
};

export const parsePaste = (text: string, timeZone: string) => {
    const fact = extractLineup(
        { id: 0, kind: 'message', sentAt: new Date(), text: keyword.test(text) ? text : `Склади\n${text}`, media: [] },
        { ...emptyConfig, timeZone },
        makeVenueMatcher(emptyConfig)
    );

    return isDefined(fact) && fact.teams.length >= 2 ? fact.teams : null;
};

const directory = Effect.fn('Core.pasteDirectory')(function* (communityId: string, sessionId: string) {
    const db = yield* Db;
    const people = yield* db
        .select({ personId: person.id, name: person.displayName, tgUserId: telegramAccount.tgUserId, username: telegramAccount.username })
        .from(person)
        .innerJoin(membership, and(eq(membership.personId, person.id), eq(membership.communityId, communityId)))
        .leftJoin(telegramAccount, eq(telegramAccount.personId, person.id))
        .where(isNull(person.mergedIntoPersonId));
    const aliases = yield* db
        .select({ personId: personAlias.personId, aliasNorm: personAlias.aliasNorm })
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), inArray(personAlias.resolution, ['confirmed', 'vote', 'suggested'])));
    const playing = yield* db
        .select({ personId: signup.personId, name: person.displayName })
        .from(signup)
        .innerJoin(person, eq(person.id, signup.personId))
        .where(and(eq(signup.sessionId, sessionId), eq(signup.status, 'in')));

    return { people, aliases, playing };
});

// Who a name means: by name or a known alias, players of this game first
const matcherOf = (known: Effect.Success<ReturnType<typeof directory>>) => {
    const playingIds = new Set(known.playing.map(row => row.personId));

    return (aliasNorm: string): string[] => {
        const byName = [...known.playing, ...known.people].filter(row => normalizeAlias(row.name) === aliasNorm).map(row => row.personId);
        const byAlias = known.aliases
            .filter(row => row.aliasNorm === aliasNorm)
            .flatMap(row => (isDefined(row.personId) ? [row.personId] : []));
        const found = [...new Set([...byName, ...byAlias])];
        const inGame = found.filter(personId => playingIds.has(personId));

        return isNotEmptyArray(inGame) ? inGame : found;
    };
};

export const lookupName = Effect.fn('Core.lookupName')(function* (communityId: string, sessionId: string, name: string) {
    const known = yield* directory(communityId, sessionId);
    const found = matcherOf(known)(normalizeAlias(name));

    return found.map(personId => ({
        personId,
        displayName: [...known.playing, ...known.people].find(row => row.personId === personId)?.name ?? name,
        isPlaying: known.playing.some(row => row.personId === personId)
    }));
});

export const resolvePaste = Effect.fn('Core.resolvePaste')(function* (
    communityId: string,
    sessionId: string,
    teams: NonNullable<ReturnType<typeof parsePaste>>
) {
    const known = yield* directory(communityId, sessionId);
    const matches = matcherOf(known);
    const labelOf = (personId: string): string => {
        const found = known.people.find(row => row.personId === personId) ?? known.playing.find(row => row.personId === personId);
        const handle = known.people.find(row => row.personId === personId && isDefined(row.username))?.username;

        return `${found?.name ?? '?'}${isDefined(handle) ? ` @${handle}` : ''}`;
    };
    const memberOf = (member: (typeof teams)[number]['members'][number]): PasteMember => {
        const mentioned = known.people.find(row => isDefined(member.userId) && row.tgUserId === BigInt(member.userId));
        const found = isDefined(mentioned) ? [mentioned.personId] : matches(member.aliasNorm);

        return {
            name: member.alias,
            personId: found.length === 1 ? (found[0] ?? null) : null,
            candidates: found.length > 1 ? found.slice(0, 6).map(personId => ({ personId, label: labelOf(personId) })) : [],
            guests: member.guests + (member.guest?.count ?? 0),
            hostName: member.guest?.host ?? null,
            isGk: member.isGk,
            isGuest: isDefined(member.guest)
        };
    };

    return {
        revision: 0,
        teams: teams.map(team => ({
            colour: badgeOfEmoji(team.emoji)?.colour ?? null,
            members: team.members.map(member => memberOf(member))
        }))
    } satisfies Paste;
});

export const openQuestion = (paste: Paste) => {
    const members = paste.teams.flatMap(team => team.members);
    const ambiguous = members.findIndex(member => !isDefined(member.personId) && isNotEmptyArray(member.candidates));
    const unknown = members.filter(member => !isDefined(member.personId) && !isNotEmptyArray(member.candidates) && !member.isGuest);

    return { ambiguous, unknown: unknown.map(member => member.name) };
};

export const choose = (paste: Paste, index: number, personId: string | null): Paste => {
    let position = -1;

    return {
        revision: paste.revision + 1,
        teams: paste.teams.map(team => ({
            colour: team.colour,
            members: team.members.flatMap(member => {
                position += 1;

                if (position !== index) {
                    return [member];
                }

                return isDefined(personId) ? [{ ...member, personId, candidates: [] }] : [];
            })
        }))
    };
};

const placeGuests = Effect.fn('Core.placePastedGuests')(function* (
    change: { readonly communityId: string; readonly sessionId: string; readonly actorPersonId: string | null },
    host: string | null,
    wanted: number
) {
    const existing = isDefined(host) ? yield* guestsOf(change.sessionId, host) : [];
    const missing = Math.max(0, wanted - existing.length);
    const created = missing > 0 ? yield* addGuests(change, { hostPersonId: host, count: missing, name: null }) : [];

    return [...existing.map(row => row.personId), ...created.filter(row => row.status === 'in').map(row => row.personId)].slice(0, wanted);
});

export const applyPaste = Effect.fn('Core.applyPaste')(function* (
    change: { readonly communityId: string; readonly sessionId: string; readonly actorPersonId: string | null },
    paste: Paste,
    addUnknown: boolean
) {
    const members = paste.teams.flatMap(team => team.members);
    const { waiting } = yield* joinGame(
        change,
        members.flatMap(member => (isDefined(member.personId) ? [member.personId] : []))
    );
    const hostOf = (name: string | null) =>
        members.find(member => isDefined(name) && normalizeAlias(member.name) === normalizeAlias(name))?.personId ?? null;
    const teams: string[][] = [];
    const keepers: string[] = [];
    const twice: { readonly name: string; readonly team: number }[] = [];
    const queued: string[] = [];
    const firstTeam = new Map<string, number>();
    const fresh = (personIds: readonly string[], team: number): string[] =>
        personIds.filter(personId => {
            const isNew = !firstTeam.has(personId);
            firstTeam.set(personId, firstTeam.get(personId) ?? team);

            return isNew;
        });

    for (const [index, team] of paste.teams.entries()) {
        const placed: string[] = [];

        for (const member of team.members) {
            const earlier = firstTeam.get(member.personId ?? '');

            if (isDefined(earlier)) {
                twice.push({ name: member.name, team: earlier });
            } else if (waiting.includes(member.personId ?? '')) {
                queued.push(member.name);
            } else if (isDefined(member.personId)) {
                const guests = yield* placeGuests(change, member.personId, member.guests);
                placed.push(...fresh([member.personId, ...guests], index));
            } else if (member.isGuest) {
                const guests = yield* placeGuests(change, hostOf(member.hostName), member.guests);
                placed.push(...fresh(guests, index));
            } else if (addUnknown) {
                const [guest] = yield* addGuests(change, { hostPersonId: null, count: 1, name: member.name });
                placed.push(...fresh(guest?.status === 'in' ? [guest.personId] : [], index));
            }

            if (member.isGk && isDefined(member.personId) && !isDefined(earlier)) {
                keepers.push(member.personId);
            }
        }

        teams.push(placed);
    }

    return { teams, keepers, twice, queued, colours: paste.teams.map(team => team.colour) };
});
