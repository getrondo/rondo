import { isError } from '@rnw-community/shared';
import * as Cause from 'effect/Cause';
import * as Predicate from 'effect/Predicate';

const codeOf = (failure: unknown): string => {
    if (Predicate.hasProperty(failure, '_tag') && Predicate.isString(failure._tag)) {
        return failure._tag;
    }

    return isError(failure) ? failure.name : 'unknown';
};

// The message of a failure may carry query parameters, and with them the words of a player
export const causeCodes = (cause: Cause.Cause<unknown>): string =>
    cause.reasons
        .map(reason => {
            if (Cause.isFailReason(reason)) {
                return codeOf(reason.error);
            }

            return Cause.isDieReason(reason) ? `defect ${codeOf(reason.defect)}` : 'interrupted';
        })
        .join(', ');
