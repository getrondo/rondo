import * as Option from 'effect/Option';

export const lookupId = (ids: ReadonlyMap<string, string | undefined>, key: string | undefined): string | undefined =>
    Option.fromNullishOr(key).pipe(
        Option.flatMapNullishOr(value => ids.get(value)),
        Option.getOrUndefined
    );
