import { getContextServiceCall } from '../get-context-service-call.mjs';

const WORKSPACE_DIRECTORY_PATTERN = /(?:^|\/)(?:apps|packages)\/([^/]+)\/src\//u;

const getExpectedId = (filename, className) => {
    const [, workspaceDirectory = null] = filename.split('\\').join('/').match(WORKSPACE_DIRECTORY_PATTERN) ?? [];

    if (workspaceDirectory === null) {
        return null;
    }

    return `@rondo/${workspaceDirectory}/${className}`;
};

export default {
    meta: {
        type: 'problem',
        docs: { description: "Require Context.Service ids to be '@rondo/<workspace>/<ClassName>'." },
        schema: [],
        messages: {
            wrongId: "Service id '{{id}}' must be '{{expected}}'.",
            wrongName: "Service id '{{id}}' must end with '/{{className}}'."
        }
    },
    create(context) {
        return {
            ClassDeclaration(node) {
                const serviceCall = getContextServiceCall(node);
                const [idNode] = serviceCall?.arguments ?? [];

                if (node.id === null || idNode?.type !== 'Literal' || typeof idNode.value !== 'string') {
                    return;
                }

                const className = node.id.name;
                const expected = getExpectedId(context.filename, className);

                if (expected !== null && idNode.value !== expected) {
                    context.report({ node: idNode, messageId: 'wrongId', data: { id: idNode.value, expected } });
                } else if (expected === null && !idNode.value.endsWith(`/${className}`)) {
                    context.report({ node: idNode, messageId: 'wrongName', data: { id: idNode.value, className } });
                }
            }
        };
    }
};
