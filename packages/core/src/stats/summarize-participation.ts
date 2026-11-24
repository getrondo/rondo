import { playedOutcomes, type PeriodStatistics, type PersonGame, type PersonPoll } from './participation.model';

const countOf = <Item>(items: readonly Item[], isCounted: (item: Item) => boolean): number => items.filter(item => isCounted(item)).length;

export const hasYes = ({ polls }: Pick<PersonGame, 'polls'>): boolean => polls.some(({ choice }) => choice === 'yes');

export const summarize = (polls: readonly PersonPoll[], games: readonly PersonGame[]): PeriodStatistics => {
    const participation = polls.filter(({ kind }) => kind === 'participation');
    const yes = participation.filter(({ choice }) => choice === 'yes');
    const named = games.filter(({ squad }) => squad === 'named');
    const withYes = games.filter(game => hasYes(game));

    return {
        polls: {
            unit: 'polls',
            answered: polls.length,
            participationYes: yes.length,
            participationYesTwoAnswers: countOf(yes, ({ answers }) => answers === 2),
            participationYesMoreAnswers: countOf(yes, ({ answers }) => answers !== 2),
            participationNo: countOf(participation, ({ choice }) => choice === 'no'),
            participationUnreadable: countOf(participation, ({ choice }) => choice === 'other'),
            reserveYes: countOf(polls, ({ kind, choice }) => kind === 'reserve' && choice === 'yes')
        },
        games: {
            unit: 'games',
            withYesVote: withYes.length,
            namedInSquad: named.length,
            yesAndInSquad: countOf(named, game => hasYes(game)),
            yesWithoutPostedSquad: countOf(withYes, ({ squad }) => squad === 'not_posted'),
            yesButNotInSquad: countOf(withYes, ({ squad }) => squad === 'not_named'),
            inSquadWithoutVote: countOf(named, ({ vote }) => vote === 'none'),
            inSquadDespiteNo: countOf(named, ({ vote }) => vote === 'no'),
            attendanceRecorded: countOf(games, ({ attendance }) => playedOutcomes.some(outcome => outcome === attendance))
        }
    };
};
