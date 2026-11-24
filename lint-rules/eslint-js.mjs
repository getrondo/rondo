import { builtinRules } from 'eslint/use-at-your-own-risk';

export default {
    meta: { name: 'eslint-js' },
    rules: {
        camelcase: builtinRules.get('camelcase'),
        'no-invalid-this': builtinRules.get('no-invalid-this'),
        'no-undef-init': builtinRules.get('no-undef-init'),
        'require-atomic-updates': builtinRules.get('require-atomic-updates')
    }
};
