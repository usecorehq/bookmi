/**
 * Bookmi drizzle schema — single Supabase Postgres, isolated in the
 * `bookmi` schema so it coexists with qore-* tables in `public` on the
 * same local DB.
 *
 * Two sections:
 *   1. Payments — provider-agnostic ledger + audit + webhook receipts,
 *      ported verbatim from qore-backend.
 *   2. Bookmi domain — host profile, wallet, services, bookings, payouts.
 *
 * Migration workflow:
 *   pnpm --filter @bookmi/api db:generate --name=<what_changed>
 *   pnpm --filter @bookmi/api db:migrate
 *
 * Always pass --name; migrations are named semantically after what they do
 * (e.g. bookmi_setup, add_slot_holds) — never drizzle's random codenames.
 */

import {
  pgSchema,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const bookmi = pgSchema("bookmi");

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: PAYMENTS
// ═══════════════════════════════════════════════════════════════════════

// ─── Country + provider routing ───────────────────────────────────────

export const countries = bookmi.table("countries", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  defaultCurrency: text("default_currency").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const paymentProviders = bookmi.table("payment_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const countryPaymentProviders = bookmi.table(
  "country_payment_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countryCode: text("country_code").notNull(),
    providerCode: text("provider_code").notNull(),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    countryProviderUniq: uniqueIndex("cpp_country_provider_uniq").on(
      t.countryCode,
      t.providerCode,
    ),
    countryPriorityIdx: index("cpp_country_priority_idx").on(t.countryCode, t.priority),
  }),
);

// ─── Transactions ────────────────────────────────────────────────────

export const paymentTransactions = bookmi.table(
  "payment_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),

    providerCode: text("provider_code").notNull(),
    providerReference: text("provider_reference"),

    status: text("status").notNull().default("pending"),
    // pending | processing | success | failed | abandoned | reversed

    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    feeMinor: bigint("fee_minor", { mode: "number" }),
    netAmountMinor: bigint("net_amount_minor", { mode: "number" }),

    countryCode: text("country_code").notNull(),

    purposeType: text("purpose_type").notNull(),
    purposeId: uuid("purpose_id"),

    businessId: uuid("business_id"),
    initiatorUserId: uuid("initiator_user_id").notNull(),
    payerEmail: text("payer_email").notNull(),

    authorizationCode: text("authorization_code"),
    accessCode: text("access_code"),
    authorizationUrl: text("authorization_url"),
    metadata: jsonb("metadata").notNull().default({}),
    idempotencyKey: text("idempotency_key"),

    initiatedAt: timestamp("initiated_at", { withTimezone: true }).defaultNow().notNull(),
    providerInitiatedAt: timestamp("provider_initiated_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    webhookReceivedAt: timestamp("webhook_received_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    providerRefUniq: uniqueIndex("pt_provider_ref_uniq")
      .on(t.providerCode, t.providerReference)
      .where(sql`${t.providerReference} IS NOT NULL`),
    idempotencyUniq: uniqueIndex("pt_idempotency_uniq")
      .on(t.initiatorUserId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    businessIdx: index("pt_business_idx").on(t.businessId),
    purposeIdx: index("pt_purpose_idx").on(t.purposeType, t.purposeId),
    statusIdx: index("pt_status_idx").on(t.status),
  }),
);

// ─── Append-only audit ───────────────────────────────────────────────

export const paymentEvents = bookmi.table(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id").notNull(),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    source: text("source").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    txIdx: index("pe_tx_idx").on(t.transactionId, t.createdAt),
  }),
);

// ─── Webhook receipt log (idempotency at the edge) ───────────────────

export const paymentWebhookEvents = bookmi.table(
  "payment_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerCode: text("provider_code").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    signature: text("signature"),
    rawPayload: jsonb("raw_payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    transactionId: uuid("transaction_id"),
    error: text("error"),
  },
  (t) => ({
    providerEventUniq: uniqueIndex("pwe_provider_event_uniq").on(
      t.providerCode,
      t.providerEventId,
    ),
    unprocessedIdx: index("pwe_unprocessed_idx")
      .on(t.receivedAt)
      .where(sql`${t.processedAt} IS NULL`),
  }),
);

export const paymentTransactionRelations = relations(paymentTransactions, ({ many }) => ({
  events: many(paymentEvents),
}));

export const paymentEventRelations = relations(paymentEvents, ({ one }) => ({
  transaction: one(paymentTransactions, {
    fields: [paymentEvents.transactionId],
    references: [paymentTransactions.id],
  }),
}));

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: BOOKMI DOMAIN
// ═══════════════════════════════════════════════════════════════════════

/**
 * Default operating hours — Mon–Sun 09:00–18:00. Frontend renders the grid
 * on ProfilePage so the host can edit per weekday, close a day, etc.
 * Shape matches what the availability generator (public/availability.service.ts)
 * expects: { [weekday]: { open: "HH:mm", close: "HH:mm", closed: boolean } }.
 */
const DEFAULT_OPERATING_HOURS = {
  monday: { open: "09:00", close: "18:00", closed: false },
  tuesday: { open: "09:00", close: "18:00", closed: false },
  wednesday: { open: "09:00", close: "18:00", closed: false },
  thursday: { open: "09:00", close: "18:00", closed: false },
  friday: { open: "09:00", close: "18:00", closed: false },
  saturday: { open: "09:00", close: "18:00", closed: false },
  sunday: { open: "09:00", close: "18:00", closed: false },
};

export const hostProfiles = bookmi.table(
  "host_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().unique(),
    slug: text("slug").notNull().unique(),
    displayName: text("display_name").notNull(),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    accentColor: text("accent_color"),
    /** Per-weekday hours. See DEFAULT_OPERATING_HOURS for shape. */
    operatingHours: jsonb("operating_hours").notNull().default(DEFAULT_OPERATING_HOURS),
    /** Optional phone/address shown on the public page. */
    phone: text("phone"),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugIdx: index("hp_slug_idx").on(t.slug),
  }),
);

export const hostWallets = bookmi.table("host_wallets", {
  hostId: uuid("host_id")
    .primaryKey()
    .references(() => hostProfiles.id, { onDelete: "cascade" }),
  monnifyWalletReference: text("monnify_wallet_reference"),
  reservedAccountNumber: text("reserved_account_number"),
  reservedBankName: text("reserved_bank_name"),
  balanceKobo: bigint("balance_kobo", { mode: "number" }).notNull().default(0),
  bankCode: text("bank_code"),
  bankAccountNumber: text("bank_account_number"),
  bankAccountName: text("bank_account_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const services = bookmi.table(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hostProfiles.id, { onDelete: "cascade" }),
    /**
     * 'booking' → shows in the wizard (requires date + time).
     * 'tip'     → skips calendar entirely; direct-share link goes straight
     *             to a pay-what-you-want amount picker. Used for Buy Me a
     *             Coffee-style receiving.
     */
    type: text("type").notNull().default("booking"),
    /**
     * Per-host slug. URL surface: `/<host-slug>/<service-slug>` — pre-selects
     * this service in the wizard (booking) or opens the tip page (tip).
     * Auto-generated from title on create, uniquified with a numeric suffix.
     */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    priceKobo: bigint("price_kobo", { mode: "number" }).notNull(),
    durationMinutes: integer("duration_minutes"),
    payWhatYouWant: boolean("pay_what_you_want").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    hostIdx: index("svc_host_idx").on(t.hostId, t.active),
    slugUniq: uniqueIndex("svc_host_slug_uniq").on(t.hostId, t.slug),
  }),
);

export const customers = bookmi.table(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hostProfiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Nullable — anonymous tippers may skip it. Unique per host when set. */
    phone: text("phone"),
    email: text("email"),
    /** Host-authored notes (allergies, preferences). Not shown to the customer. */
    notes: text("notes"),
    /**
     * Rolled up from bookings on settlement. Cheap denormalization so the
     * customer list can sort by "top spender" without a join.
     */
    totalBookings: integer("total_bookings").notNull().default(0),
    totalSpentKobo: bigint("total_spent_kobo", { mode: "number" }).notNull().default(0),
    firstBookingAt: timestamp("first_booking_at", { withTimezone: true }),
    lastBookingAt: timestamp("last_booking_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    hostIdx: index("cust_host_idx").on(t.hostId),
    // Partial-unique on phone so the storefront's phone-first dedup lookup
    // is enforced at the DB level; multiple no-phone rows per host are OK.
    hostPhoneUniq: uniqueIndex("cust_host_phone_uniq")
      .on(t.hostId, t.phone)
      .where(sql`${t.phone} IS NOT NULL`),
    hostNameIdx: index("cust_host_name_idx").on(t.hostId, t.name),
  }),
);

export const bookings = bookmi.table(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hostProfiles.id),
    /**
     * The customer this booking belongs to. Nullable because legacy rows
     * (pre-migration) won't have one and dashboard bookings might skip the
     * customer step. Populated from `resolveOrCreate` on public checkout.
     */
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    /**
     * The services this booking covers. UUID[] to support multi-select in the
     * customer wizard (see images 11–13). Cannot be a Postgres FK on an array
     * type — integrity enforced at write time in HostsService/CheckoutService.
     */
    serviceIds: uuid("service_ids").array().notNull().default(sql`'{}'::uuid[]`),
    /** Sum of chosen services' durations; drives slot generation + overlap check. */
    durationMinutes: integer("duration_minutes").notNull().default(30),
    /**
     * Short customer-facing handle like "X8-GAFJ". Generated in the service
     * layer; kept globally UNIQUE.
     */
    code: text("code").unique(),
    /** 'storefront' = created via public wizard; 'dashboard' = host created it manually. */
    source: text("source").notNull().default("storefront"),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone"),
    /** Free-form notes the customer typed in step 3 of the wizard. */
    customerNotes: text("customer_notes"),
    slotStartAt: timestamp("slot_start_at", { withTimezone: true }),
    amountKobo: bigint("amount_kobo", { mode: "number" }).notNull(),
    platformFeeKobo: bigint("platform_fee_kobo", { mode: "number" }).notNull().default(0),
    netToHostKobo: bigint("net_to_host_kobo", { mode: "number" }).notNull().default(0),
    status: text("status").notNull().default("pending"),
    // pending | confirmed | canceled | failed | arrived | seated | completed | no_show
    // Enforced at the DTO layer via Zod. Kept as plain text so admin scripts can
    // fix outliers without dropping a CHECK constraint.
    paymentTransactionId: uuid("payment_transaction_id").references(
      () => paymentTransactions.id,
    ),
    /**
     * Cumulative amount refunded to the customer, in kobo. Nullable so
     * pre-refund rows read as untouched (vs. a coerced 0). Partial refunds
     * accumulate here; a full refund equals `amountKobo`.
     */
    refundedAmountKobo: bigint("refunded_amount_kobo", { mode: "number" }),
    /** Host-supplied free-form note attached at refund time — audit trail. */
    refundReason: text("refund_reason"),
    /** Timestamp of the most recent refund. Null until the first refund lands. */
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    hostStatusIdx: index("bk_host_status_idx").on(t.hostId, t.status),
    slotIdx: index("bk_slot_idx").on(t.hostId, t.slotStartAt),
  }),
);

export const payouts = bookmi.table(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hostProfiles.id),
    amountKobo: bigint("amount_kobo", { mode: "number" }).notNull(),
    destinationBankCode: text("destination_bank_code").notNull(),
    destinationAccountNumber: text("destination_account_number").notNull(),
    monnifyReference: text("monnify_reference"),
    status: text("status").notNull().default("initiated"),
    failureReason: text("failure_reason"),
    /**
     * Client-supplied idempotency token. Same host + same key = same payout
     * row — a retried request lands on the cached response instead of a
     * second disbursement. Nullable so pre-migration rows read as legacy.
     */
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    hostIdx: index("po_host_idx").on(t.hostId, t.status),
    idempotencyUniq: uniqueIndex("po_host_idempotency_uniq")
      .on(t.hostId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
  }),
);

/**
 * Per-operation ledger for refund disbursements. Insert-first pattern: a row
 * is created before Monnify is touched. The (booking_id, idempotency_key)
 * unique constraint is the retry-safety edge — the same idempotency key from
 * a client double-click hits the cache and returns the existing row rather
 * than minting a second disbursement.
 *
 * `monnify_reference` is deterministic — `refund:<row.id>` — so a network
 * retry to Monnify with the same reference is deduped provider-side too.
 */
export const refunds = bookmi.table(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hostProfiles.id),
    amountKobo: bigint("amount_kobo", { mode: "number" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    destinationBankCode: text("destination_bank_code").notNull(),
    destinationAccountNumber: text("destination_account_number").notNull(),
    destinationAccountName: text("destination_account_name").notNull(),
    /** Set after the provider returns — until then, the disbursement isn't dedup-anchored on the provider side. */
    monnifyReference: text("monnify_reference"),
    status: text("status").notNull().default("processing"),
    // processing | success | failed
    failureReason: text("failure_reason"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    hostIdx: index("rf_host_idx").on(t.hostId),
    bookingIdempotencyUniq: uniqueIndex("rf_booking_idempotency_uniq").on(
      t.bookingId,
      t.idempotencyKey,
    ),
    monnifyRefUniq: uniqueIndex("rf_monnify_ref_uniq")
      .on(t.monnifyReference)
      .where(sql`${t.monnifyReference} IS NOT NULL`),
  }),
);

/**
 * Short-lived OTP challenges for money-out operations (refund + withdraw).
 * SHA256(code) is stored — the plaintext lives only in the user's inbox for
 * the 5-minute window. `failed_attempts` self-locks the challenge at 5 to
 * kill brute-force.
 */
export const securityChallenges = bookmi.table(
  "security_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    purpose: text("purpose").notNull(),
    // 'refund_booking' | 'withdraw_funds'
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userPurposeExpiryIdx: index("sc_user_purpose_expiry_idx").on(
      t.userId,
      t.purpose,
      t.expiresAt,
    ),
  }),
);

// ─── Types ───────────────────────────────────────────────────────────

export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type NewPaymentTransaction = typeof paymentTransactions.$inferInsert;
export type PaymentStatus =
  | "pending"
  | "processing"
  | "success"
  | "failed"
  | "abandoned"
  | "reversed";

export type HostProfile = typeof hostProfiles.$inferSelect;
export type HostWallet = typeof hostWallets.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Payout = typeof payouts.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
export type SecurityChallenge = typeof securityChallenges.$inferSelect;

export type RefundStatus = "processing" | "success" | "failed";
export type SecurityChallengePurpose = "refund_booking" | "withdraw_funds";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "canceled"
  | "failed"
  | "arrived"
  | "seated"
  | "completed"
  | "no_show";

export type BookingSource = "storefront" | "dashboard";

/** Structural type for host_profiles.operating_hours. */
export interface OperatingHours {
  monday: DayHours;
  tuesday: DayHours;
  wednesday: DayHours;
  thursday: DayHours;
  friday: DayHours;
  saturday: DayHours;
  sunday: DayHours;
}

export interface DayHours {
  /** HH:mm 24-hour, e.g. "09:00". */
  open: string;
  /** HH:mm 24-hour, e.g. "18:00". */
  close: string;
  closed: boolean;
}
