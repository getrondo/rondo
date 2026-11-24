const EQUALITY = new Set(['===', '==', '!==', '!=']);

const TYPEOF_GUARDS = { string: 'isString', number: 'isNumber', boolean: 'isBoolean', object: 'isObject', undefined: 'isDefined' };

const isNullish = node => (node.type === 'Literal' && node.raw === 'null') || (node.type === 'Identifier' && node.name === 'undefined');

const isLiteral = (node, value) => node.type === 'Literal' && node.value === value;

const isLength = node => node.type === 'MemberExpression' && !node.computed && node.property.name === 'length';

const isTypeof = node => node.type === 'UnaryExpression' && node.operator === 'typeof';

const isMember = (node, object, property) =>
    node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === object && node.property.name === property;

const getOperands = ({ left, right }) => (left.type === 'Literal' ? [right, left] : [left, right]);

const getBinaryGuard = node => {
    const { operator } = node;

    if (operator === 'instanceof' && node.right.type === 'Identifier' && node.right.name === 'Error') {
        return 'isError';
    }

    const [subject, value] = getOperands(node);

    if (
        isLength(subject) &&
        ((EQUALITY.has(operator) && isLiteral(value, 0)) ||
            (operator === '>' && isLiteral(value, 0)) ||
            (operator === '>=' && isLiteral(value, 1)))
    ) {
        return 'isEmptyArray / isNotEmptyArray / isNotEmptyString';
    }

    if (!EQUALITY.has(operator)) {
        return null;
    }

    if (isNullish(value)) {
        return 'isDefined';
    }

    if (isLiteral(value, '')) {
        return 'isNotEmptyString / isEmptyString';
    }

    if (isTypeof(subject) && value.type === 'Literal' && value.value in TYPEOF_GUARDS) {
        const isGlobalProbe = value.value === 'undefined' && subject.argument.type === 'Identifier';

        return isGlobalProbe ? null : TYPEOF_GUARDS[value.value];
    }

    return null;
};

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description:
                'Require @rnw-community/shared type guards instead of manual nullish, typeof, array, error, length and empty-string checks.'
        },
        schema: [],
        messages: { useGuard: 'Use {{guard}} from @rnw-community/shared (AGENTS.md Validation and Errors).' }
    },
    create(context) {
        const report = (node, guard) => context.report({ node, messageId: 'useGuard', data: { guard } });

        return {
            BinaryExpression(node) {
                const guard = getBinaryGuard(node);

                if (guard !== null) {
                    report(node, guard);
                }
            },
            CallExpression(node) {
                if (isMember(node.callee, 'Array', 'isArray')) {
                    report(node, 'isArray');
                }
            },
            UnaryExpression(node) {
                if (node.operator === '!' && isLength(node.argument)) {
                    report(node, 'isEmptyArray / isNotEmptyString');
                }
            }
        };
    }
};
