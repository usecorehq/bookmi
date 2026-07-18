function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  supabaseUrl: required("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: required("VITE_SUPABASE_ANON_KEY", import.meta.env.VITE_SUPABASE_ANON_KEY),
  apiUrl: required("VITE_API_URL", import.meta.env.VITE_API_URL),
  monnifyApiKey: required("VITE_MONNIFY_API_KEY", import.meta.env.VITE_MONNIFY_API_KEY),
  monnifyContractCode: required(
    "VITE_MONNIFY_CONTRACT_CODE",
    import.meta.env.VITE_MONNIFY_CONTRACT_CODE,
  ),
};
