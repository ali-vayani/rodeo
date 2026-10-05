import type { TemplateKey } from '$lib/email/templates';
import { storedAttachmentRefs } from './emailAttachments';

export function emailTemplate(
	settings: Record<`${TemplateKey}Subject` | `${TemplateKey}Template`, string> &
		Partial<Record<`${TemplateKey}Attachments`, unknown>>,
	key: TemplateKey
) {
	const attachmentRefs = storedAttachmentRefs(settings[`${key}Attachments`]);
	return {
		subject: settings[`${key}Subject`],
		body: settings[`${key}Template`],
		...(attachmentRefs.length ? { attachmentRefs } : {})
	};
}
