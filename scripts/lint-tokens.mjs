#!/usr/bin/env node
/**
 * Enforces the two rules from docs/design-language.md:
 *
 *   1. No hex codes outside app.css.
 *   2. No raw numbers for size, space, or type.
 *
 * Scoped to the directories that have been migrated onto the design system.
 * Widen SCOPES as pages land; delete the list once all of src/ passes.
 *
 *   npm run lint:tokens
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Paths that must already be token-clean. Add to this as pages migrate. */
const SCOPES = [
	'src/lib/components/ui',
	'src/lib/components/patterns',
	'src/routes/design',
	'src/routes/admin/blacklist',
	'src/lib/components/blacklist',
	'src/routes/admin/schedule',
	'src/lib/components/schedule',
	'src/lib/components/email',
	'src/routes/admin/custom-email',
	'src/routes/admin/logs',
	'src/routes/admin/dashboard',
	'src/lib/components/admin/charts',
	// The hacker portal, migrated onto the brand layer in app.css.
	//
	// `components/account` and `routes/login` are deliberately absent: QRCard renders
	// to a canvas via the qrcode library and `routes/login` draws Google's own logo,
	// so both carry hex that is not ours to tokenize.
	'src/routes/hacker',
	'src/lib/components/hacker',
	'src/lib/components/brand',
	'src/lib/components/application',
	'src/routes/reset-password'
	// Pages are appended here as they migrate. Everything not listed still predates the
	// design system; see docs/component-library-plan.md for the remaining queue.
];

/**
 * Arbitrary values that are pure `var()` plumbing carry no magic number of ours.
 * Select reads --bits-select-anchor-width from bits-ui. Allowed.
 */
const VAR_ONLY = /^\[var\(--[\w-]+\)\]$/;

const RULES = [
	{
		name: 'hex color',
		// #abc / #aabbcc / #aabbccdd, but not a CSS var or an id selector.
		pattern: /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/g,
		hint: 'use a color token from app.css (e.g. text-foreground, bg-success-50)'
	},
	{
		name: 'arbitrary value',
		// Deliberately excludes grid-cols/grid-rows: a `1fr 1.2fr auto` template is layout
		// structure, not a design value.
		pattern:
			/\b(?:text|p[xytblrse]?|m[xytblrse]?|gap|space-[xy]|w|h|size|min-w|max-w|min-h|max-h|top|right|bottom|left|inset|rounded(?:-[a-z]+)?|border(?:-[lrtbxy])?|tracking|leading|shadow|z|opacity|translate-[xy])-\[[^\]]+\]/g,
		hint: 'add a token to app.css, or use a named Tailwind class'
	}
];

function walk(dir) {
	let out = [];
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return out; // Scope not created yet — not an error.
	}
	for (const entry of entries) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out = out.concat(walk(full));
		else if (/\.(svelte|ts)$/.test(entry) && !entry.endsWith('.test.ts')) out.push(full);
	}
	return out;
}

/**
 * Blanks out comments so prose describing the old classes doesn't trip the
 * rules it is describing.
 */
function stripComments(source) {
	return source
		.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length))
		.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
		.replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const violations = [];

for (const scope of SCOPES) {
	for (const file of walk(join(ROOT, scope))) {
		const source = stripComments(readFileSync(file, 'utf8'));
		const lines = source.split('\n');

		for (const rule of RULES) {
			lines.forEach((line, index) => {
				for (const match of line.matchAll(rule.pattern)) {
					const token = match[0];
					if (rule.name === 'arbitrary value') {
						const bracket = token.slice(token.indexOf('['));
						if (VAR_ONLY.test(bracket)) continue;
					}
					violations.push({
						file: relative(ROOT, file),
						line: index + 1,
						rule: rule.name,
						token,
						hint: rule.hint
					});
				}
			});
		}
	}
}

if (violations.length === 0) {
	console.log(`✓ lint:tokens — ${SCOPES.length} scoped paths clean`);
	process.exit(0);
}

console.error(`✗ lint:tokens — ${violations.length} violation(s)\n`);
for (const v of violations) {
	console.error(`  ${v.file}:${v.line}`);
	console.error(`    ${v.rule}: ${v.token}`);
	console.error(`    → ${v.hint}\n`);
}
console.error('These rules are documented in docs/design-language.md §1.');
process.exit(1);
