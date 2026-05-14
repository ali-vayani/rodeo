import { env } from '$env/dynamic/private';

function require(key: string): string {
	const val = env[key as keyof typeof env];
	if (!val) throw new Error(`Missing required environment variable: ${key}`);
	return val as string;
}

export function validateEnv() {
	require('DATABASE_URL');

	if (process.env.NODE_ENV === 'production') {
		require('SUPABASE_URL');
		require('SUPABASE_ANON_KEY');
	}
}
