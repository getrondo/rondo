const isEffectImport = source => source === 'effect' || source.startsWith('effect/');

export default {
    meta: {
        type: 'problem',
        docs: { description: 'Disallow try, throw and new Promise in files that use Effect.' },
        schema: [],
        messages: { useEffect: 'Use Effect (see AGENTS.md ## Effect)' }
    },
    create(context) {
        const nodes = [];
        let usesEffect = false;

        return {
            ImportDeclaration(node) {
                usesEffect ||= isEffectImport(node.source.value);
            },
            TryStatement(node) {
                nodes.push(node);
            },
            ThrowStatement(node) {
                nodes.push(node);
            },
            NewExpression(node) {
                if (node.callee.type === 'Identifier' && node.callee.name === 'Promise') {
                    nodes.push(node);
                }
            },
            'Program:exit'() {
                if (usesEffect) {
                    for (const node of nodes) {
                        context.report({ node, messageId: 'useEffect' });
                    }
                }
            }
        };
    }
};
