export const isSettledPoll = (description: string): boolean => /poll has already been closed|to stop not found/iu.test(description);
