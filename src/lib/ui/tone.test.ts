import { describe, it, expect } from 'vitest';
import { decisionTone, statusTone, scheduleTypeTone } from './tone';

describe('decisionTone', () => {
	it('maps each decision to its tone', () => {
		expect(decisionTone('ACCEPTED')).toBe('success');
		expect(decisionTone('REJECTED')).toBe('danger');
		expect(decisionTone('WAITLISTED')).toBe('warning');
		expect(decisionTone('PENDING')).toBe('neutral');
	});

	it('treats an absent decision as neutral', () => {
		expect(decisionTone(null)).toBe('neutral');
		expect(decisionTone(undefined)).toBe('neutral');
	});
});

describe('statusTone', () => {
	it('colors only the endpoints of the funnel', () => {
		expect(statusTone('CHECKED_IN')).toBe('info');
		expect(statusTone('CONFIRMED')).toBe('success');
		expect(statusTone('DECLINED')).toBe('danger');
	});

	it('keeps the common early states quiet', () => {
		expect(statusTone('CREATED')).toBe('neutral');
		expect(statusTone('APPLIED')).toBe('neutral');
	});

	it('treats an absent status as neutral', () => {
		expect(statusTone(null)).toBe('neutral');
	});
});

describe('scheduleTypeTone', () => {
	it('gives each schedule type a distinct tone', () => {
		expect(scheduleTypeTone('MEAL')).toBe('warning');
		expect(scheduleTypeTone('WORKSHOP')).toBe('info');
		expect(scheduleTypeTone('CEREMONY')).toBe('success');
		expect(scheduleTypeTone('EVENT')).toBe('neutral');
	});
});
