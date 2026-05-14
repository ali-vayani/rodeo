import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/auth';
import { validateEnv } from '$lib/server/env';
import { Role } from '$lib/generated/prisma/client';

validateEnv();

const ADMIN_ROLES: Role[] = [Role.ADMIN, Role.ORGANIZER];

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await getSession(event);

	const { pathname } = event.url;
	const user = event.locals.user;

	// Redirect authenticated users away from login
	if (pathname === '/login' && user) {
		const isAdmin = user.roles.some((r) => ADMIN_ROLES.includes(r));
		redirect(302, isAdmin ? '/admin/dashboard' : '/hacker/application');
	}

	// Guard /hacker/* and /admin/* routes
	if (pathname.startsWith('/hacker/') || pathname.startsWith('/admin/')) {
		if (!user) {
			const redirectTo = encodeURIComponent(pathname);
			redirect(302, `/login?redirectTo=${redirectTo}`);
		}

		// Non-admin trying to access /admin/*
		if (pathname.startsWith('/admin/') && !user.roles.some((r) => ADMIN_ROLES.includes(r))) {
			redirect(302, '/hacker/application');
		}
	}

	return resolve(event);
};
