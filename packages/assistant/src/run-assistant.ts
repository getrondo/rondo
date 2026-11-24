import { isNotEmptyString } from '@rnw-community/shared';
import { generateText, isStepCount } from 'ai';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';

import { appendHistory, loadHistory } from './history/conversation.repository';
import { ASSISTANT_MODEL } from './model/assistant-model.constant';
import { buildSystemPrompt, type PromptContext } from './prompt/system.prompt';
import { AiGateway } from './service/ai-gateway.service';
import { buildTools, type ToolRunner, type ToolScope } from './tools/build-tools';

import type { Locale } from '@rondo/core/i18n/locale';
import type { Db } from '@rondo/db/service/db.service';
import type { Telegram } from '@rondo/telegram/service/telegram.service';

export interface AssistantRequest {
    readonly communityId: string;
    readonly tgUserId: bigint;
    readonly locale: Locale;
    readonly prompt: PromptContext;
    readonly userText: string;
}

interface AssistantReply {
    readonly text: string;
    readonly proposals: readonly { readonly actionId: string; readonly summary: string }[];
}

const firstLine = (cause: Cause.Cause<unknown>): string => Cause.pretty(cause).split('\n')[0] ?? 'error';

export const runAssistant = Effect.fn('Assistant.run')(function* (request: AssistantRequest) {
    const gateway = yield* AiGateway;
    const context = yield* Effect.context<Db | Telegram>();
    const history = yield* loadHistory(request.tgUserId);
    const scope: ToolScope = { communityId: request.communityId, tgUserId: request.tgUserId, locale: request.locale, proposals: [] };
    const run: ToolRunner = async effect =>
        await Effect.runPromiseWith(context)(
            effect.pipe(
                Effect.tapCause(cause => Effect.logWarning(`[assistant] tool failed ${firstLine(cause)}`)),
                Effect.catchCause(cause => Effect.succeed({ error: firstLine(cause) }))
            )
        );

    const result = yield* Effect.tryPromise(
        async () =>
            await generateText({
                model: gateway(ASSISTANT_MODEL.gatewayId),
                instructions: buildSystemPrompt(request.prompt),
                messages: [...history, { role: 'user', content: request.userText }],
                tools: buildTools(scope, run),
                stopWhen: isStepCount(ASSISTANT_MODEL.maxSteps),
                maxOutputTokens: ASSISTANT_MODEL.maxOutputTokens,
                providerOptions: { gateway: { models: [...ASSISTANT_MODEL.fallbackGatewayIds] } }
            })
    );
    const text = result.text.trim();

    yield* appendHistory(request.tgUserId, [
        { role: 'user', content: request.userText },
        { role: 'assistant', content: isNotEmptyString(text) ? text : '…' }
    ]);

    return { text, proposals: scope.proposals } satisfies AssistantReply;
});
