<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<div class="flex min-h-screen items-center justify-center bg-white">
	<div class="text-center">
		<p class="font-mono text-xs tracking-widest text-muted-foreground uppercase">
			Hackathon Management
		</p>
		<h1 class="mt-1 font-mono text-3xl font-bold tracking-widest text-primary uppercase">RODEO</h1>
		<p class="mt-2 text-sm text-muted-foreground">Sign in to access your portal</p>

		<a
			href={resolve('/login')}
			class="mt-8 inline-block rounded bg-primary px-6 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85"
		>
			Sign in →
		</a>

		<p class="mt-12 font-mono text-xs text-muted-foreground">
			RODEO · Hackathon Management Platform
		</p>
	</div>
</div>
