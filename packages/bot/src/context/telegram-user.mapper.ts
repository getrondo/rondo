import { isDefined } from '@rnw-community/shared';

import type { TelegramUser } from '@rondo/core/identity/telegram-user';
import type { User } from 'grammy/types';

export const toTelegramUser = (user: User): TelegramUser => ({
    id: BigInt(user.id),
    firstName: user.first_name,
    ...(isDefined(user.last_name) ? { lastName: user.last_name } : {}),
    ...(isDefined(user.username) ? { username: user.username } : {}),
    ...(isDefined(user.language_code) ? { languageCode: user.language_code } : {})
});
