/**
 * Nested config namespace consumed by providers via `config.get('monnify.baseUrl')`.
 *
 * The flat process.env is validated in env.validation.ts, then this factory
 * maps it into the shape services actually read — so a rename in the env
 * doesn't ripple into every consumer.
 */
export type BookmiConfig = ReturnType<typeof buildConfig>;

export function buildConfig(env: NodeJS.ProcessEnv) {
  return {
    nodeEnv: (env.NODE_ENV ?? "development") as "development" | "production" | "test",
    appEnv: (env.APP_ENV ?? "dev") as "dev" | "staging" | "sandbox" | "prod",
    port: parseInt(env.PORT ?? "4000", 10),
    corsOrigins: env.CORS_ORIGINS!,

    supabase: {
      url: env.SUPABASE_URL!,
      anonKey: env.SUPABASE_ANON_KEY!,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
      jwtSecret: env.SUPABASE_JWT_SECRET!,
      dbUrl: env.SUPABASE_DB_URL!,
      /** Secret used to verify GoTrue Send Email hook requests (optional). */
      emailHookSecret: env.SUPABASE_EMAIL_HOOK_SECRET,
    },

    monnify: {
      baseUrl: env.MONNIFY_BASE_URL!,
      apiKey: env.MONNIFY_API_KEY!,
      secretKey: env.MONNIFY_SECRET_KEY!,
      contractCode: env.MONNIFY_CONTRACT_CODE!,
      webhookSecret: env.MONNIFY_WEBHOOK_SECRET!,
      /**
       * Linked Monnify disbursement wallet account number — the source of
       * funds for outbound transfers (refunds, host payouts). Required for
       * MonnifyProvider.disburse(); if unset, the call throws so callers see
       * a clear misconfiguration error instead of a Monnify 4xx.
       */
      disbursementWallet: env.MONNIFY_DISBURSEMENT_WALLET,
      /**
       * Rollout toggle for the dedicated refund API (`POST
       * /api/v1/refunds/initiate-refund`) in `HostBookingsService.refundBooking()`.
       * Defaults to `false` — every deployment keeps calling `disburse()`
       * exactly as it does today, byte-for-byte, until this is explicitly
       * set to `true` after a sandbox smoke test confirms the `refundAmount`
       * wire type and the refund webhook's field names (see
       * `MonnifyProvider.refund()`/`parseRefundWebhook`).
       */
      useRefundApi: (env.MONNIFY_USE_REFUND_API ?? "false") === "true",
      /**
       * Rollout toggle for the real reserved-account API (`POST
       * /api/v2/bank-transfer/reserved-accounts`) in
       * `HostWalletService.activateReservedAccount()`. Defaults to `false` —
       * every deployment keeps fabricating a mock reserved account until
       * this is explicitly set to `true` after a sandbox smoke test.
       */
      useReservedAccountApi: (env.MONNIFY_USE_RESERVED_ACCOUNT_API ?? "false") === "true",
      /**
       * Optional single partner bank code (e.g. Moniepoint) to restrict
       * reserved-account provisioning to. Unset requests every partner bank
       * Monnify supports (`getAllAvailableBanks: true`) and surfaces the
       * first one returned.
       */
      reservedAccountBankCode: env.MONNIFY_RESERVED_ACCOUNT_BANK_CODE || undefined,
    },

    platform: {
      /** Basis points cut from each successful booking payment. 250 = 2.5%. */
      feeBps: parseInt(env.PLATFORM_FEE_BPS ?? "250", 10),
    },

    mailer: {
      host: env.SMTP_HOST ?? "localhost",
      port: parseInt(env.SMTP_PORT ?? "1025", 10),
      user: env.SMTP_USER ?? "",
      pass: env.SMTP_PASS ?? "",
      secure: (env.SMTP_SECURE ?? "false") === "true",
      fromAddress: env.EMAIL_FROM_ADDRESS ?? "no-reply@bookmi.co",
      fromName: env.EMAIL_FROM_NAME ?? "Bookmi",
    },

    web: {
      /** Public URL of the frontend — used to construct links in emails. */
      baseUrl: env.WEB_BASE_URL ?? "http://localhost:5173",
    },

    redis: {
      host: env.REDIS_HOST ?? "localhost",
      port: parseInt(env.REDIS_PORT ?? "6379", 10),
      password: env.REDIS_PASSWORD ?? "",
      queueDb: parseInt(env.REDIS_QUEUE_DB ?? "1", 10),
    },

    bullBoard: {
      /** If both are set, mount the Bull Board UI at /api/admin/queues with basic auth. */
      user: env.BULL_BOARD_USER ?? "",
      pass: env.BULL_BOARD_PASS ?? "",
    },
  };
}

export default () => buildConfig(process.env);
