import { isDefined, isNotEmptyString } from '@rnw-community/shared';

import { fromShortId } from '../../utils/from-short-id.util';
import { toShortId } from '../../utils/to-short-id.util';

export interface TeamsTap {
    readonly sessionId: string;
    readonly version: number;
    readonly page: number;
    readonly op: string;
    readonly args: readonly string[];
}

export interface TeamsBase {
    readonly sessionId: string;
    readonly version: number;
    readonly page: number;
}

const tapPattern = /^t:(?<id>[\w-]{22}):(?<version>\d{1,6}):(?<page>\d):(?<op>[A-Za-z]{1,2})((?::[\w-]{1,22}){0,3})$/u;

export const teamsData = (base: TeamsBase, op: string, args: readonly (string | number)[] = []): string =>
    ['t', toShortId(base.sessionId), base.version, base.page, op, ...args].join(':');

export const parseTeamsData = (data: string): TeamsTap | null => {
    const match = tapPattern.exec(data);
    const sessionId = fromShortId(match?.groups?.id ?? '');

    if (!isDefined(match) || !isDefined(sessionId)) {
        return null;
    }

    return {
        sessionId,
        version: Number(match.groups?.version),
        page: Number(match.groups?.page),
        op: match.groups?.op ?? '',
        args: (match[5] ?? '').split(':').filter(part => isNotEmptyString(part))
    };
};
