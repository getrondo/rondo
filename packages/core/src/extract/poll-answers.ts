import type { VoteChoice } from '../model/telegram-snapshot.model';

export const plusAnswer = /^[+➕✔✅]/u;
const yesAnswer = /^(?:[+➕✔✅]|буду|играем|да$|yes$)/iu;
const refusal = /^(?:[-–➖❌🙅✖🚫]|нет(?!\p{L})|не\s|играть не\s|no$)|\(-\)/iu;
const otherPlan = /только на (?!игр)/iu;
const time = /(?<!\d)\d{1,2}[.: ]\d{2}(?!\d)/u;
const format = /(?<!\d)\d{1,2}\s?[xх×]\s?\d{1,2}(?!\d)/iu;
const participation = /^\P{L}*(?:буду|могу|при[йи]?ду|прихожу|играем|без разницы)(?!\p{L})/iu;

const isSignupPair = (answers: readonly string[]): boolean => {
    const [first = '', second = ''] = answers;

    return yesAnswer.test(first) || refusal.test(second);
};

const readAnswer = (answer: string): VoteChoice => {
    if (refusal.test(answer)) {
        return 'no';
    }

    const isYes = plusAnswer.test(answer) || time.test(answer) || format.test(answer) || participation.test(answer);

    return isYes && !otherPlan.test(answer) ? 'yes' : 'other';
};

export const answerChoice = (answers: readonly string[], index: number): VoteChoice => {
    const trimmed = answers.map(answer => answer.trim());

    if (trimmed.length !== 2) {
        return readAnswer(trimmed[index] ?? '');
    }

    if (!isSignupPair(trimmed)) {
        return 'other';
    }

    return index === 0 ? 'yes' : 'no';
};
