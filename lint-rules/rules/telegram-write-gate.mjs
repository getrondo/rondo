const ALLOWED = new Set(['answerCallbackQuery', 'getChat', 'getWebhookInfo', 'leaveChat', 'sendChatAction', 'setMyCommands', 'setWebhook']);

const isNamed = (node, name) => node.type === 'Identifier' && node.name === name;

export default {
    meta: {
        type: 'problem',
        docs: { description: 'Keep every Telegram write behind the group gate and the private chat helpers.' },
        schema: [],
        messages: {
            gate: '{{method}} writes to a chat. Use writeToChat (groups, with an approval) or the helpers of private-chat.ts.'
        }
    },
    create(context) {
        const report = (node, method) => {
            if (!ALLOWED.has(method)) {
                context.report({ node, messageId: 'gate', data: { method } });
            }
        };

        return {
            CallExpression(node) {
                const { callee } = node;
                const [method] = node.arguments;

                if (callee.type !== 'MemberExpression') {
                    return;
                }

                if (isNamed(callee.object, 'api')) {
                    report(node, callee.computed ? 'a computed method' : callee.property.name);
                } else if (isNamed(callee.object, 'telegram') && callee.property.name === 'call' && method?.type === 'Literal') {
                    report(node, method.value);
                }
            }
        };
    }
};
