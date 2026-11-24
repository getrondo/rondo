import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { makeRecorder, recordingTelegramLayer } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Layer from 'effect/Layer';

export const recorder = makeRecorder();

export const recordedTelegramDbLayer = Layer.mergeAll(testDbLayer, recordingTelegramLayer(recorder));
