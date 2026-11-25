import type { TelegramMessage } from '@rondo/core/model/telegram-message.model';
import type { TelegramSnapshot } from '@rondo/core/model/telegram-snapshot.model';
import type * as Option from 'effect/Option';

export interface ChatContent {
    readonly messages: readonly TelegramMessage[];
    readonly snapshot: Option.Option<TelegramSnapshot>;
}
