import * as Config from 'effect/Config';

export const importSettings = Config.all({
    exportDir: Config.String('RONDO_EXPORT_DIR'),
    configPath: Config.String('RONDO_COMMUNITY_CONFIG'),
    allowRemoval: Config.Boolean('RONDO_ALLOW_REMOVAL').pipe(Config.withDefault(false))
});
