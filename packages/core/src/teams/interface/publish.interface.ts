import type { PostTeam } from './lineup-post.interface';

type DeliveryStatus = 'sent' | 'edited' | 'unchanged' | 'refused' | 'uncertain' | 'busy';

export interface PlannedDelivery {
    readonly chatId: bigint;
    readonly topicId: number | null;
    readonly title: string | null;
    readonly html: string;
    readonly text: string;
    readonly messageId: number | null;
    readonly stored: 'claimed' | 'sent' | 'uncertain' | 'refused' | null;
    readonly token: string | null;
    readonly isDue: boolean;
}

export interface LineupPlan {
    readonly version: number;
    readonly teams: readonly PostTeam[];
    readonly deliveries: readonly PlannedDelivery[];
    readonly diff: readonly string[];
    readonly isUpdate: boolean;
    readonly clearsResult: boolean;
    readonly fingerprint: string;
}

export interface DeliveryOutcome {
    readonly chatId: bigint;
    readonly title: string | null;
    readonly status: DeliveryStatus;
    readonly reason: string | null;
    readonly isEdit: boolean;
}

export interface PublishOutcome {
    readonly deliveries: readonly DeliveryOutcome[];
    readonly diff: readonly string[];
}
