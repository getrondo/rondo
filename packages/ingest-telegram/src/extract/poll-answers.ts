export const yesAnswer = /^(?:[+➕✔✅]|буду|играем|да$|yes$)/iu;

export const noAnswer = /^(?:[-–➖❌🙅✖🚫]|нет|не\s|no$)/iu;

export const isSignupPair = (answers: readonly string[]): boolean => {
    const [first = '', second = ''] = answers.map(answer => answer.trim());

    return yesAnswer.test(first) || noAnswer.test(second);
};
