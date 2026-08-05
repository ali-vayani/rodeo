import type { ScheduleType } from '$lib/generated/prisma/enums';

/** One tab in the day selector. `key` is a `YYYY-MM-DD` day key, or `'other'`. */
export interface DayTab {
	key: string;
	label: string;
	sublabel: string;
}

/** The payload `EventForm` emits — matches `scheduleInput` in the schedule router. */
export interface EventInput {
	name: string;
	description?: string;
	start: Date;
	end: Date;
	location: string;
	type: ScheduleType;
}

/** Key used for events that fall outside the two hackathon days. */
export const OTHER_DAY = 'other';
