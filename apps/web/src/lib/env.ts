function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/**
 * Vars are split into required (checked at import) and optional (checked
 * lazily by the code path that needs them). Monnify creds only matter on
 * the checkout screen — auth/dashboard pages should boot without them.
 */
export const env = {
  supabaseUrl: required("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: required("VITE_SUPABASE_ANON_KEY", import.meta.env.VITE_SUPABASE_ANON_KEY),
  apiUrl: required("VITE_API_URL", import.meta.env.VITE_API_URL),
};

/** Called by the checkout flow — never at module init. */
export function getMonnifyEnv() {
  return {
    apiKey: required("VITE_MONNIFY_API_KEY", import.meta.env.VITE_MONNIFY_API_KEY),
    contractCode: required(
      "VITE_MONNIFY_CONTRACT_CODE",
      import.meta.env.VITE_MONNIFY_CONTRACT_CODE,
    ),
  };
}
