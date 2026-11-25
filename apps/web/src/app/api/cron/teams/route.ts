import { cronRoute } from '@/server/cron-route';
import { runTeamsTick } from '@rondo/bot/jobs/teams.job';

export const maxDuration = 60;

export const GET = cronRoute('teams', runTeamsTick);
