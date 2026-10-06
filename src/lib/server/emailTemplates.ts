import type { Role, TemplateOverride } from '$lib/generated/prisma/client';
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

/**
 * Resolves the effective template for a given key + role.
 *
 * If a `TemplateOverride` row exists for this key/role combination, it takes
 * precedence over the default Settings template. Otherwise the default is used.
 */
export function resolveTemplate(
	settings: Record<`${TemplateKey}Subject` | `${TemplateKey}Template`, string> &
		Partial<Record<`${TemplateKey}Attachments`, unknown>>,
	overrides: Pick<TemplateOverride, 'templateKey' | 'role' | 'subject' | 'body' | 'attachments'>[],
	key: TemplateKey,
	role: Role
) {
	const override = overrides.find((o) => o.templateKey === key && o.role === role);
	if (override) {
		const attachmentRefs = storedAttachmentRefs(override.attachments);
		return {
			subject: override.subject,
			body: override.body,
			...(attachmentRefs.length ? { attachmentRefs } : {})
		};
	}
	return emailTemplate(settings, key);
}
