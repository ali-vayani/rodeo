/**
 * The base `User` columns a CSV export can include, in canonical order. Shared by the
 * server export procedure and the Users page export modal, so a column the checkbox
 * list offers is exactly one the server knows how to fill in — and so a column always
 * lands in the same place in the file regardless of the order it was checked in.
 */
export const USER_EXPORT_COLUMNS = [
	'uid',
	'name',
	'email',
	'role',
	'status',
	'pendingDecision',
	'activeDecision',
	'teamId',
	'createdAt'
] as const;

export type UserExportColumn = (typeof USER_EXPORT_COLUMNS)[number];

/** Display labels for the export modal's checkboxes. */
export const USER_EXPORT_COLUMN_LABELS: Record<UserExportColumn, string> = {
	uid: 'User ID',
	name: 'Name',
	email: 'Email',
	role: 'Role',
	status: 'Status',
	pendingDecision: 'Pending Decision',
	activeDecision: 'Decision',
	teamId: 'Team ID',
	createdAt: 'Created At'
};
