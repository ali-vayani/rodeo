import { describe, it, expect } from 'vitest';
import { isPdfFilename } from './files';

describe('isPdfFilename', () => {
	it('accepts a PDF', () => {
		expect(isPdfFilename('resume.pdf')).toBe(true);
	});

	it('ignores case, since the extension comes from the uploader', () => {
		expect(isPdfFilename('Resume.PDF')).toBe(true);
	});

	it('ignores surrounding whitespace', () => {
		expect(isPdfFilename('  resume.pdf  ')).toBe(true);
	});

	it('rejects other formats', () => {
		expect(isPdfFilename('resume.docx')).toBe(false);
		expect(isPdfFilename('resume.png')).toBe(false);
	});

	it('rejects a name that merely contains .pdf', () => {
		// The one that matters: a match here would serve `evil.pdf.html` inline.
		expect(isPdfFilename('evil.pdf.html')).toBe(false);
	});

	it('rejects a name with no extension', () => {
		expect(isPdfFilename('resume')).toBe(false);
		expect(isPdfFilename('')).toBe(false);
	});
});
