import { router } from './init';
import { userRouter } from './routers/user';
import { admissionsRouter } from './routers/admissions';
import { applicationRouter } from './routers/application';
import { questionsRouter } from './routers/questions';
import { settingsRouter } from './routers/settings';
import { scheduleRouter } from './routers/schedule';
import { blacklistRouter } from './routers/blacklist';
import { scanRouter } from './routers/scan';
import { teamRouter } from './routers/team';
import { emailRouter } from './routers/email';
import { dashboardRouter } from './routers/dashboard';
import { logRouter } from './routers/log';
import { filtersRouter } from './routers/filters';
import { statsRouter } from './routers/stats';
import { dataRouter } from './routers/data';

export const appRouter = router({
	user: userRouter,
	admissions: admissionsRouter,
	application: applicationRouter,
	questions: questionsRouter,
	settings: settingsRouter,
	schedule: scheduleRouter,
	blacklist: blacklistRouter,
	scan: scanRouter,
	team: teamRouter,
	email: emailRouter,
	dashboard: dashboardRouter,
	log: logRouter,
	filters: filtersRouter,
	stats: statsRouter,
	data: dataRouter
});

export type AppRouter = typeof appRouter;
