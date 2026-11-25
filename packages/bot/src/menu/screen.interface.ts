export interface MenuButton {
    readonly text: string;
    readonly callback_data: string;
}

export interface Screen {
    readonly text: string;
    readonly keyboard: MenuButton[][];
}

export interface MenuUser {
    readonly tgUserId: bigint;
    readonly chatId: number;
    readonly communityId: string;
    readonly locale: 'uk' | 'ru';
    readonly now: Date;
    readonly today: string;
    readonly nowTime: string;
    readonly timezone: string;
}
