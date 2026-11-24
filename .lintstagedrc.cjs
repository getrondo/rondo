const quoteFileNames = fileNames => fileNames.map(fileName => JSON.stringify(fileName)).join(' ');

module.exports = {
    '*': fileNames => {
        const scriptFileNames = fileNames.filter(fileName => /\.(?:[cm]?[jt]s|[jt]sx)$/u.test(fileName));
        const lintCommands =
            scriptFileNames.length > 0
                ? [
                      `effect-tsgo --tsrs-lint oxlint --type-aware --fix --deny-warnings --no-error-on-unmatched-pattern ${quoteFileNames(scriptFileNames)}`
                  ]
                : [];

        return [...lintCommands, `oxfmt --no-error-on-unmatched-pattern ${quoteFileNames(fileNames)}`];
    }
};
