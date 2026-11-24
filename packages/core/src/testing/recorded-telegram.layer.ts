import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { makeRecorder, recordingTelegramLayer } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Layer from 'effect/Layer';

import { Access } from '../access/admin-access';

export const recorder = makeRecorder();

export const recordedTelegramDbLayer = Layer.mergeAll(testDbLayer, recordingTelegramLayer(recorder), Access.layerFor([42n]));
