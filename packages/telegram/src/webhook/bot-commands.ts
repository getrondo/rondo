type CommandLocale = 'uk' | 'ru';

interface BotCommandEntry {
    readonly command: string;
    readonly description: string;
}

export const adminCommands: Readonly<Record<CommandLocale, readonly BotCommandEntry[]>> = {
    uk: [
        { command: 'newgame', description: 'Нова гра' },
        { command: 'games', description: 'Ігри' },
        { command: 'menu', description: 'Меню' },
        { command: 'start', description: 'Почати' },
        { command: 'reset', description: 'Почати розмову з асистентом заново' }
    ],
    ru: [
        { command: 'newgame', description: 'Новая игра' },
        { command: 'games', description: 'Игры' },
        { command: 'menu', description: 'Меню' },
        { command: 'start', description: 'Начать' },
        { command: 'reset', description: 'Начать разговор с ассистентом заново' }
    ]
};

export const memberCommands: Readonly<Record<CommandLocale, readonly BotCommandEntry[]>> = {
    uk: [{ command: 'start', description: 'Що вміє бот' }],
    ru: [{ command: 'start', description: 'Что умеет бот' }]
};
