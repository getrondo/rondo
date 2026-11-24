import type { personAlias } from '@rondo/db/schema/identity.schema';
import type { lineupEntry } from '@rondo/db/schema/play.schema';

export type Alias = typeof personAlias.$inferSelect;

export type EntryRow = typeof lineupEntry.$inferInsert;

export interface Directory {
    readonly personIdByAccount: ReadonlyMap<bigint, string>;
    readonly accountByHandle: ReadonlyMap<string, bigint>;
    readonly aliasByNorm: ReadonlyMap<string, Alias>;
}

export interface ResolvedMember {
    readonly personId: string | null;
    readonly tgUserId?: bigint;
    readonly aliasId?: string;
    readonly resolvedBy: EntryRow['resolvedBy'];
}

export interface SeenAlias {
    readonly alias: string;
    readonly aliasNorm: string;
    readonly kind: 'nickname' | 'self';
    readonly personName: string | null;
    readonly occurrences: number;
    readonly firstSeenAt: Date;
    readonly lastSeenAt: Date;
}
