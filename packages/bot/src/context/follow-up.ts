import * as Option from 'effect/Option';

import type { AiGateway } from '@rondo/assistant/service/ai-gateway.service';
import type { Access } from '@rondo/core/access/admin-access';
import type { Db } from '@rondo/db/service/db.service';
import type { Telegram } from '@rondo/telegram/service/telegram.service';
import type * as Effect from 'effect/Effect';

export type FollowUp = Option.Option<Effect.Effect<void, never, Db | Telegram | AiGateway | Access>>;

export const noFollowUp: FollowUp = Option.none();
