/**
 * The registry of audit-log action slugs.
 *
 * Isomorphic: the routers import `LogAction` to type their writes and /admin/logs
 * imports `LOG_ACTION_GROUPS` to build its filter. The union is derived from this
 * array, so an unregistered slug is a type error rather than an unfindable row.
 */

/**
 * `key` lands in `Log.action` and is never rendered raw. `label` is the filter's option
 * text, and `group` is the optgroup heading, mirroring the admin sidebar.
 */
export const LOG_ACTIONS = [
	// Admissions
	{ key: 'admissions.score.set', label: 'Application scored', group: 'Admissions' },
	{ key: 'admissions.decision.set', label: 'Decision set', group: 'Admissions' },
	{ key: 'admissions.decision.bulk', label: 'Decisions set in bulk', group: 'Admissions' },
	{ key: 'admissions.decision.blocked', label: 'Decision blocked by lock', group: 'Admissions' },
	{ key: 'admissions.decision.clear', label: 'Decision cleared', group: 'Admissions' },
	{ key: 'admissions.release', label: 'Decisions released', group: 'Admissions' },

	// Users
	// Slug stays plural though a user now holds one role: it is what existing Log rows
	// were written with, and renaming it would orphan every historical entry.
	{ key: 'user.roles.update', label: 'Role changed', group: 'Users' },
	{ key: 'user.status.update', label: 'Status changed', group: 'Users' },
	{ key: 'user.decision.override', label: 'Decision overridden', group: 'Users' },
	{ key: 'user.export', label: 'User list exported', group: 'Users' },

	// Application editor
	{ key: 'question.create', label: 'Question added', group: 'Application' },
	{ key: 'question.update', label: 'Question edited', group: 'Application' },
	{ key: 'question.delete', label: 'Question deleted', group: 'Application' },
	{ key: 'question.reorder', label: 'Questions reordered', group: 'Application' },
	{ key: 'question.batch', label: 'Application form saved', group: 'Application' },

	// Data
	{ key: 'data.export', label: 'Full database exported', group: 'Settings' },
	{ key: 'data.wipe', label: 'Database wiped', group: 'Settings' },

	// Settings
	{ key: 'settings.update', label: 'Settings updated', group: 'Settings' },
	{ key: 'settings.templates.update', label: 'Email templates updated', group: 'Settings' },
	{ key: 'food.groups.generate', label: 'Food groups generated', group: 'Settings' },
	{ key: 'food.groups.rename', label: 'Food group renamed', group: 'Settings' },
	{ key: 'food.groups.release', label: 'Food groups released', group: 'Settings' },

	// Schedule
	{ key: 'schedule.create', label: 'Event added', group: 'Schedule' },
	{ key: 'schedule.update', label: 'Event edited', group: 'Schedule' },
	{ key: 'schedule.delete', label: 'Event deleted', group: 'Schedule' },

	// Blacklist
	{ key: 'blacklist.add', label: 'Blacklist entry added', group: 'Blacklist' },
	{ key: 'blacklist.import', label: 'Blacklist CSV imported', group: 'Blacklist' },
	{ key: 'blacklist.remove', label: 'Blacklist entry removed', group: 'Blacklist' },

	// Scan
	{ key: 'scan.record', label: 'Scan recorded', group: 'Scan' },

	// Email
	{ key: 'email.custom.start', label: 'Custom email started', group: 'Email' },
	{ key: 'email.custom.send', label: 'Custom email sent', group: 'Email' },
	{ key: 'email.test.send', label: 'Test email sent', group: 'Email' },

	// Wallet
	{
		key: 'wallet.provisionGoogleClass',
		label: 'Google Wallet class provisioned',
		group: 'Settings'
	},

	/** Rows written before the audit-record migration. Nothing writes this slug; it exists
	    so old history renders a label instead of the raw key. */
	{ key: 'legacy', label: 'Legacy entry', group: 'Other' }
] as const;

export type LogAction = (typeof LOG_ACTIONS)[number]['key'];

export type LogActionGroup = (typeof LOG_ACTIONS)[number]['group'];

const LABELS: Record<string, string> = Object.fromEntries(LOG_ACTIONS.map((a) => [a.key, a.label]));

/** Human label for a slug, falling back to the slug itself so a row written by a
    future version still renders. */
export function actionLabel(action: string): string {
	return LABELS[action] ?? action;
}

/** The registry keyed by group, in registry order, for the filter's optgroups. */
export const LOG_ACTION_GROUPS: Array<{
	group: LogActionGroup;
	actions: Array<{ key: LogAction; label: string }>;
}> = LOG_ACTIONS.reduce(
	(groups, action) => {
		const existing = groups.find((g) => g.group === action.group);
		const entry = { key: action.key, label: action.label };
		if (existing) existing.actions.push(entry);
		else groups.push({ group: action.group, actions: [entry] });
		return groups;
	},
	[] as Array<{ group: LogActionGroup; actions: Array<{ key: LogAction; label: string }> }>
);
