/**
 * Turning a `Question.optionPreset` into rows a `Combobox` can render.
 *
 * The one place that knows a preset is more than a name. Both the applicant's form and
 * the editor's preview go through it, so what an organizer previews is what an
 * applicant is offered — including the alias matching, which is invisible until you
 * type and would otherwise be easy to wire up in one place and forget in the other.
 */

import type { OptionPreset } from '$lib/generated/prisma/client';
import type { ComboboxOption } from '$lib/components/ui/types';
import { loadUniversities, universityLabel } from '$lib/data/universities';

/**
 * The rows for a preset, fetched lazily.
 *
 * Async because the university list is 650 KB behind a dynamic `import()` — see
 * `$lib/data/universities` for why it must not be in the entry chunk.
 *
 * The stored answer is the institution's plain name, never the decorated label: the
 * label carries a city to tell six `Columbia College`s apart, and writing " — Chicago,
 * IL" into `User.university` would put it in every filter row and every CSV export.
 */
export async function loadPresetOptions(preset: OptionPreset): Promise<ComboboxOption[]> {
	switch (preset) {
		case 'UNIVERSITIES_NA': {
			const { countries, universities } = await loadUniversities();
			return universities.map((university) => ({
				value: university.name,
				label: universityLabel(university, countries),
				keywords: university.aliases
			}));
		}
	}
}
