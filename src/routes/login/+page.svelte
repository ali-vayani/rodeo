<script lang="ts">
	import { createBrowserClient } from '@supabase/ssr';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	let signingIn = $state(false);

	// A failed sign-up posts back and re-renders the page, so the mode has to be
	// recovered from the action result or the error would render under a
	// sign-in form that doesn't match it. Reading only the initial `form` is
	// deliberate: these forms post without use:enhance, so every action response
	// arrives via a full page load that remounts this component.
	// svelte-ignore state_referenced_locally
	let mode: 'signin' | 'signup' = $state(
		form?.signupError || form?.signupPending ? 'signup' : 'signin'
	);

	async function signInWithGoogle() {
		if (!data.supabaseUrl || !data.supabaseAnonKey) return;

		signingIn = true;
		const supabase = createBrowserClient(data.supabaseUrl, data.supabaseAnonKey);

		// `next` rides along so /auth/callback can land the user on the page they
		// originally asked for instead of always dropping them at a portal root.
		const callback = new URL('/auth/callback', window.location.origin);
		if (data.redirectTo) callback.searchParams.set('next', data.redirectTo);

		const { error } = await supabase.auth.signInWithOAuth({
			provider: 'google',
			options: { redirectTo: callback.toString() }
		});

		// Only reached if the redirect never happened — on success the browser has
		// already left this page.
		if (error) signingIn = false;
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-white px-6">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<p class="font-mono text-xs tracking-widest text-muted-foreground uppercase">
				Hackathon Management
			</p>
			<h1 class="mt-1 font-mono text-3xl font-bold tracking-widest text-primary uppercase">
				RODEO
			</h1>
			<p class="mt-2 text-sm text-muted-foreground">
				{data.supabaseAuth ? 'Sign in to continue' : 'Dev login — enter your yopmail address'}
			</p>
		</div>

		{#if data.oauthError}
			<p class="mb-4 text-sm text-destructive">Sign-in failed. Please try again.</p>
		{/if}

		{#if data.supabaseAuth}
			<!--
				Deployed environments sign in through Supabase: Google, or email and
				password. Either way the first login creates the account — sign-up
				registers with Supabase, and the local User row is provisioned on the
				first authenticated request. Preview deploys additionally render the
				yopmail form below, for the seeded test accounts.
			-->
			<button
				onclick={signInWithGoogle}
				disabled={signingIn}
				class="flex w-full items-center justify-center gap-3 rounded border border-border px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-muted disabled:opacity-60"
			>
				<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
					<path
						fill="#4285F4"
						d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
					/>
					<path
						fill="#34A853"
						d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
					/>
					<path
						fill="#FBBC05"
						d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
					/>
					<path
						fill="#EA4335"
						d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
					/>
				</svg>
				{signingIn ? 'Redirecting…' : 'Sign in with Google'}
			</button>

			{#if form?.error && !data.yopmailLogin}
				<p class="mt-3 text-sm text-destructive">{form.error}</p>
			{/if}

			<div class="my-6 flex items-center gap-3">
				<div class="h-px flex-1 bg-border"></div>
				<span class="font-mono text-xs text-muted-foreground uppercase">or</span>
				<div class="h-px flex-1 bg-border"></div>
			</div>

			{#if form?.signupPending}
				<p class="mb-3 text-sm text-muted-foreground">
					Check your email for a confirmation link, then sign in.
				</p>
			{/if}

			<form
				method="POST"
				action={mode === 'signup' ? '?/signup' : '?/password'}
				class="flex flex-col gap-3"
			>
				{#if data.redirectTo}
					<input type="hidden" name="redirectTo" value={data.redirectTo} />
				{/if}

				{#if mode === 'signup'}
					<input
						type="text"
						name="name"
						placeholder="Full name"
						required
						autocomplete="name"
						class="w-full rounded border border-border px-3 py-2 text-sm outline-none focus:border-primary"
					/>
				{/if}

				<input
					type="email"
					name="email"
					placeholder="you@example.com"
					required
					autocomplete="email"
					class="w-full rounded border border-border px-3 py-2 text-sm outline-none focus:border-primary"
				/>

				<input
					type="password"
					name="password"
					placeholder="Password"
					required
					autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
					class="w-full rounded border border-border px-3 py-2 text-sm outline-none focus:border-primary"
				/>

				{#if mode === 'signup' ? form?.signupError : form?.passwordError}
					<p class="text-sm text-destructive">
						{mode === 'signup' ? form?.signupError : form?.passwordError}
					</p>
				{/if}

				<button
					type="submit"
					class="w-full rounded bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85"
				>
					{mode === 'signup' ? 'Create account' : 'Sign in'} →
				</button>
			</form>

			<button
				type="button"
				onclick={() => (mode = mode === 'signup' ? 'signin' : 'signup')}
				class="mt-3 w-full text-center text-sm text-muted-foreground hover:text-primary"
			>
				{mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
			</button>
		{/if}

		{#if data.supabaseAuth && data.yopmailLogin}
			<div class="my-6 flex items-center gap-3">
				<div class="h-px flex-1 bg-border"></div>
				<span class="font-mono text-xs text-muted-foreground uppercase">or test account</span>
				<div class="h-px flex-1 bg-border"></div>
			</div>
		{/if}

		{#if data.yopmailLogin}
			<form method="POST" action="?/yopmail" class="flex flex-col gap-3">
				{#if data.redirectTo}
					<input type="hidden" name="redirectTo" value={data.redirectTo} />
				{/if}
				<input
					type="email"
					name="email"
					placeholder="you@yopmail.com"
					required
					autocomplete="email"
					class="w-full rounded border border-border px-3 py-2 text-sm outline-none focus:border-primary"
				/>

				{#if form?.error}
					<p class="text-sm text-destructive">{form.error}</p>
				{/if}

				<button
					type="submit"
					class="w-full rounded bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85"
				>
					Sign in →
				</button>
			</form>
		{/if}

		<p class="mt-8 text-center font-mono text-xs text-muted-foreground">
			RODEO · Hackathon Management Platform
		</p>
	</div>
</div>
