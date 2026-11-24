import type { CommunityConfig } from '../config/community-config';
import type { ImportPlan } from '../extract/assemble-plan';
import type { TelegramSnapshot } from '../model/telegram-snapshot.model';
import type { Transaction } from './transaction.type';

export interface LoadContext {
    readonly transaction: Transaction;
    readonly communityId: string;
    readonly config: CommunityConfig;
    readonly plan: ImportPlan;
    readonly snapshot?: TelegramSnapshot;
    readonly allowRemoval?: boolean;
}

export interface ReferenceIds {
    readonly activityIdBySport: ReadonlyMap<string, string>;
    readonly venueIdByKey: ReadonlyMap<string, string | undefined>;
    readonly colorIdByEmoji: ReadonlyMap<string, string>;
}

export interface SessionLoadResult {
    readonly sessionIds: readonly string[];
    readonly ambiguousDates: readonly string[];
    readonly teams: number;
    readonly entries: number;
    readonly unassignedGuestRequests: number;
}
