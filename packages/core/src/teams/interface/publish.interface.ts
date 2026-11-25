export interface GroupOutcome {
    readonly chatId: bigint;
    readonly title: string;
    readonly status: 'sent' | 'edited' | 'refused';
    readonly reason: string | null;
}

export interface PublishOutcome {
    readonly groups: readonly GroupOutcome[];
    readonly privateStatus: 'sent' | 'unchanged' | null;
    readonly diff: readonly string[];
}
