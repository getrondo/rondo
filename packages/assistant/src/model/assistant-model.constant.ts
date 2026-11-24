export const ASSISTANT_MODEL = {
    gatewayId: 'anthropic/claude-haiku-5.5',
    fallbackGatewayIds: ['anthropic/claude-haiku-4.5'],
    maxSteps: 8,
    maxOutputTokens: 1200
} as const;
