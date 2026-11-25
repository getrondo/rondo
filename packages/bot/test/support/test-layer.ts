import { AiGateway } from '@rondo/assistant/service/ai-gateway.service';
import { Access } from '@rondo/core/access/admin-access';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { recordingTelegramLayer, type TelegramRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { MockLanguageModelV4 } from 'ai/test';
import * as Layer from 'effect/Layer';

import { fixedClockLayer } from './fixed-clock';

const silentModel = new MockLanguageModelV4({ doGenerate: async () => await Promise.reject(new Error('gateway down')) });

export const menuTestLayer = (recorder: TelegramRecorder) =>
    Layer.mergeAll(testDbLayer, recordingTelegramLayer(recorder), AiGateway.layerFor(silentModel), Access.layerFor([42n]), fixedClockLayer);

export const adminNumbered = (id: number, languageCode = 'uk') => ({
    id,
    is_bot: false as const,
    first_name: `Admin ${id}`,
    language_code: languageCode
});
