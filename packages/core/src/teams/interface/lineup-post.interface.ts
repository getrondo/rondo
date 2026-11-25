import type { Locale } from '../../i18n/locale';

export interface PostMember {
    readonly personId: string;
    readonly name: string;
    readonly tgUserId: bigint | null;
    readonly username: string | null;
    readonly isGk: boolean;
    readonly isGuest: boolean;
    readonly hostId: string | null;
}

export interface PostTeam {
    readonly badge: string;
    readonly members: readonly PostMember[];
}

export interface LineupPost {
    readonly locale: Locale;
    readonly title: string;
    readonly teams: readonly PostTeam[];
    readonly showHandles: boolean;
    readonly isUpdate: boolean;
}
