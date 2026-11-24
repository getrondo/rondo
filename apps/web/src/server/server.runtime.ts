// eslint-disable-next-line import/no-unassigned-import -- server-only sentinel
import 'server-only';
import { AiGateway } from '@rondo/assistant/service/ai-gateway.service';
import { Access } from '@rondo/core/access/admin-access';
import { Db } from '@rondo/db/service/db.service';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';

export const serverRuntime = ManagedRuntime.make(Layer.mergeAll(Db.layer, Telegram.layer, AiGateway.layer, Access.layer));
