import { createGateway, type LanguageModel } from 'ai';
import * as Config from 'effect/Config';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Redacted from 'effect/Redacted';

export class AiGateway extends Context.Service<AiGateway, (modelId: string) => LanguageModel>()('@rondo/assistant/AiGateway') {
    static readonly layer = Layer.effect(
        AiGateway,
        Effect.gen(function* () {
            const apiKey = yield* Config.option(Config.Redacted('AI_GATEWAY_API_KEY'));

            return createGateway({
                apiKey: apiKey.pipe(
                    Option.map(key => Redacted.value(key)),
                    Option.getOrUndefined
                )
            });
        })
    );

    static readonly layerFor = (model: LanguageModel) => Layer.succeed(AiGateway, () => model);
}
