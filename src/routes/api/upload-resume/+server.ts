import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/server/db';
import { UserStatus, QuestionType } from '$lib/generated/prisma/client';
import { uploadResume, MAX_RESUME_SIZE, ALLOWED_RESUME_TYPES } from '$lib/server/storage';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) error(401, 'Unauthorized');

	const dbUser = await prisma.user.findUniqueOrThrow({
		where: { uid: user.uid },
		select: { status: true }
	});

	if (dbUser.status !== UserStatus.CREATED) {
		error(400, 'Your application has already been submitted and can no longer be edited.');
	}

	const formData = await request.formData();
	const file = formData.get('file');
	const questionId = formData.get('questionId');

	if (!(file instanceof File)) error(400, 'No file provided.');
	if (typeof questionId !== 'string' || !questionId) error(400, 'No questionId provided.');

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const question = await (prisma.question.findUnique as any)({
		where: { id: questionId },
		select: { type: true, required: true, targetRole: true }
	});

	if (!question) error(404, 'Question not found.');
	if (question.type !== QuestionType.FILE_UPLOAD) {
		error(400, 'That question does not accept file uploads.');
	}

	// Client-side hints, echoed server-side so a direct API call can't bypass them.
	if (file.size > MAX_RESUME_SIZE) error(400, 'File must be under 10 MB.');
	if (!ALLOWED_RESUME_TYPES.includes(file.type)) {
		error(400, 'Only PDF and Word documents (.pdf, .doc, .docx) are accepted.');
	}

	let url: string;
	try {
		url = await uploadResume(user.uid, file);
	} catch (err) {
		error(500, err instanceof Error ? err.message : 'Upload failed.');
	}

	await prisma.applicationResponse.upsert({
		where: { userId_questionId: { userId: user.uid, questionId } },
		update: { value: url },
		create: { userId: user.uid, questionId, value: url }
	});

	return json({ url });
};
