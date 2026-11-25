import effectFnName from './rules/effect-fn-name.mjs';
import effectNoImperative from './rules/effect-no-imperative.mjs';
import effectNoRun from './rules/effect-no-run.mjs';
import effectServiceId from './rules/effect-service-id.mjs';
import sharedGuards from './rules/shared-guards.mjs';
import telegramWriteGate from './rules/telegram-write-gate.mjs';

export default {
    meta: { name: 'rondo' },
    rules: {
        'effect-fn-name': effectFnName,
        'effect-no-imperative': effectNoImperative,
        'effect-no-run': effectNoRun,
        'effect-service-id': effectServiceId,
        'shared-guards': sharedGuards,
        'telegram-write-gate': telegramWriteGate
    }
};
