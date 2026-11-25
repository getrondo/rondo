import { cronRoute } from '@/server/cron-route';
import { runMaintenance } from '@rondo/bot/jobs/maintenance.job';

export const maxDuration = 60;

export const GET = cronRoute('maintenance', runMaintenance);
