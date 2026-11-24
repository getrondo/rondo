import { isDefined } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { normalizeAlias } from '../extract/normalize';

import type { LineupFact, LineupMember } from '../extract/fact.model';

const stemOf = (aliasNorm: string): string => aliasNorm.replace(/[аяыиеуюоь]$/u, '');

export const hostOf = (host: string, lineup: LineupFact): Option.Option<LineupMember> => {
    const named = normalizeAlias(host.split('+')[0] ?? '');
    const players = lineup.teams.flatMap(({ members }) => members).filter(member => !isDefined(member.guest));
    const declined = players.filter(member => stemOf(member.aliasNorm) === stemOf(named));
    const isOneName = declined.every(member => member.aliasNorm === declined[0]?.aliasNorm);

    return Option.fromNullishOr(players.find(member => member.aliasNorm === named) ?? (isOneName ? declined[0] : null));
};
