export interface AdminStateRow {
    readonly tgUserId: bigint;
    readonly communityId: string;
    readonly messageId: number | null;
    readonly revision: number;
    readonly awaiting: string | null;
    readonly draft: unknown;
    readonly expiresAt: Date;
}

export interface AdminStateInput {
    readonly tgUserId: bigint;
    readonly communityId: string;
    readonly messageId: number | null;
    readonly awaiting: string | null;
    readonly draft: unknown;
    readonly now: Date;
}
