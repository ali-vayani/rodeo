<script lang="ts" module>
	/**
	 * Write a JSON export to the operator's disk.
	 *
	 * Shared with the danger zone, which has to save the file *before* it wipes —
	 * one implementation means the download that guards a wipe is the same one
	 * that has already been exercised by the plain export button.
	 */
	export function downloadExport(json: string): void {
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `rodeo-export-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<script lang="ts">
	import { errorMessage } from '$lib/ui/errors';
	import { createClient } from '$lib/trpc/client';

	let {
		onToast
	}: {
		onToast: (message: string, type?: 'success' | 'error') => void;
	} = $props();

	const trpc = createClient();

	let password = $state('');
	let exporting = $state(false);

	async function exportAll() {
		exporting = true;
		try {
			const { json, counts } = await trpc.data.exportAll.mutate({ password });
			downloadExport(json);
			// Cleared on success only: a wrong password should leave what was typed
			// in place to be corrected rather than retyped from scratch.
			password = '';
			onToast(`Exported ${counts.user} users across ${Object.keys(counts).length} tables`);
		} catch (e) {
			onToast(errorMessage(e, 'Export failed'), 'error');
		} finally {
			exporting = false;
		}
	}
</script>

<div class="max-w-[520px]">
	<p class="mt-0 mb-4 text-xs text-muted-foreground">
		Downloads every table — users, applications, questions, schedule, scans, teams, logs and
		settings — as a single JSON file. The file contains personal data for every applicant, so treat
		it like the database itself.
	</p>

	<form
		onsubmit={(e) => {
			e.preventDefault();
			if (!exporting && password) exportAll();
		}}
	>
		<label
			for="export-password"
			class="mb-1.5 block text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
		>
			Data password
		</label>
		<!-- A real password field, so browsers and managers treat it as one and it
		     never lands in an autofilled text history. -->
		<input
			id="export-password"
			type="password"
			bind:value={password}
			autocomplete="off"
			placeholder="Required"
			disabled={exporting}
			class="mb-3 w-full rounded border border-border bg-white px-3 py-[7px] text-[13px] text-primary outline-none focus-visible:shadow-ring"
		/>
		<button
			type="submit"
			disabled={exporting || password.length === 0}
			class="cursor-pointer rounded-md border border-border bg-white px-[14px] py-[7px] text-[13px] font-medium text-primary disabled:opacity-40"
		>
			{exporting ? 'Exporting…' : 'Export all data'}
		</button>
	</form>
</div>
