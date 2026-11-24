import { coverageText } from '@rondo/core/stats/coverage-text';
import { attendanceCoverage, type DateRange } from '@rondo/core/stats/stats.service';
import * as Effect from 'effect/Effect';

import type { Locale } from '@rondo/core/i18n/locale';

export const withCoverage = <Value, Failure, Requirements>(
    scope: { readonly communityId: string; readonly locale: Locale },
    query: Effect.Effect<Value, Failure, Requirements>,
    range?: DateRange
) =>
    Effect.all({ result: query, coverage: attendanceCoverage(scope.communityId, range) }).pipe(
        Effect.map(({ result, coverage }) => ({ result, coverage, coverageText: coverageText(scope.locale, coverage) }))
    );
