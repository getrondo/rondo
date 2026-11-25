import { isDefined } from '@rnw-community/shared';
import * as Predicate from 'effect/Predicate';
import * as SchemaIssue from 'effect/SchemaIssue';

const issuesOf = SchemaIssue.makeFormatterStandardSchemaV1();

// Names of fields only: the messages of the issues carry the values
export const updateShape = (payload: unknown, issue: SchemaIssue.Issue): { readonly kind: string; readonly path: string } => {
    const kind = Predicate.isObject(payload) ? Object.keys(payload).find(key => key !== 'update_id' && /^[a-z_]{1,40}$/u.test(key)) : null;
    const paths = issuesOf(issue).issues.map(entry =>
        (entry.path ?? []).filter(part => Predicate.isString(part) || Predicate.isNumber(part))
    );
    const path = paths.find(entry => entry[0] === kind) ?? [];

    return { kind: isDefined(kind) ? kind : 'none', path: path.join('.') };
};
