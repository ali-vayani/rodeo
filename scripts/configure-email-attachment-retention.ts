import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import {
	GetBucketLifecycleConfigurationCommand,
	PutBucketLifecycleConfigurationCommand,
	S3Client,
	type LifecycleRule
} from '@aws-sdk/client-s3';
import {
	EMAIL_ATTACHMENT_KEY_PREFIX,
	EMAIL_ATTACHMENT_RETENTION_DAYS
} from '../src/lib/email/attachments.ts';

const EXPIRATION_ID = 'rodeo-email-attachments-expiration';
const MARKERS_ID = 'rodeo-email-attachments-delete-markers';

export function attachmentLifecycleRules(existing: LifecycleRule[]): LifecycleRule[] {
	return [
		...existing.filter((rule) => rule.ID !== EXPIRATION_ID && rule.ID !== MARKERS_ID),
		{
			ID: EXPIRATION_ID,
			Status: 'Enabled',
			Filter: { Prefix: EMAIL_ATTACHMENT_KEY_PREFIX },
			Expiration: { Days: EMAIL_ATTACHMENT_RETENTION_DAYS },
			// Versioned buckets otherwise keep the expired file bytes indefinitely.
			NoncurrentVersionExpiration: { NoncurrentDays: 1 }
		},
		{
			ID: MARKERS_ID,
			Status: 'Enabled',
			Filter: { Prefix: EMAIL_ATTACHMENT_KEY_PREFIX },
			Expiration: { ExpiredObjectDeleteMarker: true }
		}
	];
}

export async function configureRetention(client: S3Client, bucket: string, apply: boolean) {
	let current;
	try {
		current = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
	} catch (error) {
		if (!(error instanceof Error) || error.name !== 'NoSuchLifecycleConfiguration') throw error;
	}
	const configuration = {
		Bucket: bucket,
		LifecycleConfiguration: { Rules: attachmentLifecycleRules(current?.Rules ?? []) },
		...(current?.TransitionDefaultMinimumObjectSize && {
			TransitionDefaultMinimumObjectSize: current.TransitionDefaultMinimumObjectSize
		})
	};
	if (apply) await client.send(new PutBucketLifecycleConfigurationCommand(configuration));
	return configuration;
}

async function main() {
	const { AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = process.env;
	if (!AWS_REGION || !S3_BUCKET || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
		throw new Error('Set AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.');
	}
	const apply = process.argv.includes('--apply');
	const client = new S3Client({
		region: AWS_REGION,
		credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY }
	});
	try {
		const configuration = await configureRetention(client, S3_BUCKET, apply);
		console.log(JSON.stringify(configuration, null, 2));
		console.log(apply ? 'Attachment retention applied.' : 'Preview only. Pass --apply to save.');
	} finally {
		client.destroy();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
