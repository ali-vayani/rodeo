import { describe, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import {
	attachmentLifecycleRules,
	configureRetention
} from '../../../scripts/configure-email-attachment-retention';

describe('email attachment retention', () => {
	it('preserves unrelated rules and replaces only its own rules', () => {
		const existing = {
			ID: 'application-files',
			Status: 'Disabled' as const,
			Filter: { Prefix: 'applications/' }
		};
		const rules = attachmentLifecycleRules([existing]);
		expect(rules[0]).toEqual(existing);
		expect(rules.slice(1)).toEqual([
			expect.objectContaining({
				Filter: { Prefix: 'email-attachments/' },
				Expiration: { Days: 30 },
				NoncurrentVersionExpiration: { NoncurrentDays: 1 }
			}),
			expect.objectContaining({
				Filter: { Prefix: 'email-attachments/' },
				Expiration: { ExpiredObjectDeleteMarker: true }
			})
		]);
		expect(attachmentLifecycleRules(rules)).toEqual(rules);
	});

	it('previews without changing the bucket and preserves transition settings on apply', async () => {
		const client = new S3Client({ region: 'us-east-1' });
		const send = vi.spyOn(client, 'send');
		send.mockImplementation(async () => ({
			Rules: [],
			TransitionDefaultMinimumObjectSize: 'varies_by_storage_class'
		}));
		const preview = await configureRetention(client, 'test-bucket', false);
		expect(send).toHaveBeenCalledTimes(1);
		await configureRetention(client, 'test-bucket', true);
		expect(send.mock.calls[2][0].input).toEqual(preview);
		expect(preview.TransitionDefaultMinimumObjectSize).toBe('varies_by_storage_class');
		client.destroy();
	});

	it('creates rules for a bucket with no lifecycle configuration', async () => {
		const client = new S3Client({ region: 'us-east-1' });
		const send = vi
			.spyOn(client, 'send')
			.mockRejectedValueOnce(
				Object.assign(new Error('missing'), { name: 'NoSuchLifecycleConfiguration' })
			)
			.mockImplementationOnce(async () => ({}));
		await configureRetention(client, 'test-bucket', true);
		expect(send.mock.calls[1][0].input).toMatchObject({
			LifecycleConfiguration: { Rules: attachmentLifecycleRules([]) }
		});
		client.destroy();
	});

	it('never overwrites lifecycle rules when reading them is denied', async () => {
		const client = new S3Client({ region: 'us-east-1' });
		const send = vi.spyOn(client, 'send').mockRejectedValue(new Error('AccessDenied'));
		await expect(configureRetention(client, 'test-bucket', true)).rejects.toThrow('AccessDenied');
		expect(send).toHaveBeenCalledTimes(1);
		client.destroy();
	});
});
