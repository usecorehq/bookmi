/**
 * Bookmi drizzle schema — single Supabase Postgres.
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
 * (e.g. 0000_bookmi_setup, 0001_add_slot_holds) — never drizzle's random
 * codenames.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: PAYMENTS
// ═══════════════════════════════════════════════════════════════════════

// ─── Country + provider routing ───────────────────────────────────────

export const countries = pgTable("countries", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  defaultCurrency: text("default_currency").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const paymentProviders = pgTable("payment_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const countryPaymentProviders = pgTable(
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

export const paymentTransactions = pgTable(
  "payment_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Our internal, customer-facing reference. Prefix: bookmi_pmt_
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
    // booking_checkout (bookmi has one purpose for now)
    purposeId: uuid("purpose_id"),

    // Bookmi doesn't have "businesses" like qore does — keep the column for
    // parity so shared audit tooling reads uniformly; hosts land as businessId
    // (their host_profiles.id).
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

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id").notNull(),
    eventType: text("event_type").notNull(),
    // initiated | provider_response | verified | webhook_received | status_changed | error | purpose_handled
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    source: text("source").notNull(), // client | admin | webhook | verify | system
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    txIdx: index("pe_tx_idx").on(t.transactionId, t.createdAt),
  }),
);

// ─── Webhook receipt log (idempotency at the edge) ───────────────────

export const paymentWebhookEvents = pgTable(
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

// ─── Host profile ────────────────────────────────────────────────────

export const hostProfiles = pgTable(
  "host_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // References auth.users(id) in Supabase — FK enforced via a migration.
    userId: uuid("user_id").notNull().unique(),
    slug: text("slug").notNull().unique(),
    displayName: text("display_name").notNull(),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    accentColor: text("accent_color"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugIdx: index("hp_slug_idx").on(t.slug),
  }),
);

// ─── Host wallet (Monnify reserved account + payout bank) ────────────

export const hostWallets = pgTable("host_wallets", {
  hostId: uuid("host_id")
    .primaryKey()
    .references(() => hostProfiles.id, { onDelete: "cascade" }),
  monnifyWalletReference: text("monnify_wallet_reference"),
  reservedAccountNumber: text("reserved_account_number"),
  reservedBankName: text("reserved_bank_name"),
  // Ledger balance in kobo. Only PaymentsService writes it inside a tx.
  balanceKobo: bigint("balance_kobo", { mode: "number" }).notNull().default(0),
  bankCode: text("bank_code"),
  bankAccountNumber: text("bank_account_number"),
  bankAccountName: text("bank_account_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Services offered by a host ──────────────────────────────────────

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hostProfiles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    priceKobo: bigint("price_kobo", { mode: "number" }).notNull(),
    // Nullable → open-ended service (e.g. tip); non-null → time-boxed booking.
    durationMinutes: integer("duration_minutes"),
    // When true, priceKobo is a floor — checkout accepts amounts >= priceKobo.
    payWhatYouWant: boolean("pay_what_you_want").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    hostIdx: index("svc_host_idx").on(t.hostId, t.active),
  }),
);

// ─── Bookings ────────────────────────────────────────────────────────

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hostProfiles.id),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone"),
    slotStartAt: timestamp("slot_start_at", { withTimezone: true }),
    amountKobo: bigint("amount_kobo", { mode: "number" }).notNull(),
    platformFeeKobo: bigint("platform_fee_kobo", { mode: "number" }).notNull().default(0),
    netToHostKobo: bigint("net_to_host_kobo", { mode: "number" }).notNull().default(0),
    status: text("status").notNull().default("pending"),
    // pending | confirmed | canceled | failed
    // Set once the associated payment_transactions row exists.
    paymentTransactionId: uuid("payment_transaction_id").references(
      () => paymentTransactions.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    hostStatusIdx: index("bk_host_status_idx").on(t.hostId, t.status),
    serviceIdx: index("bk_service_idx").on(t.serviceId),
    slotIdx: index("bk_slot_idx").on(t.hostId, t.slotStartAt),
  }),
);

// ─── Payouts (host withdrawals via Monnify disbursement) ─────────────

export const payouts = pgTable(
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
    // initiated | success | failed
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    hostIdx: index("po_host_idx").on(t.hostId, t.status),
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
export type Payout = typeof payouts.$inferSelect;

// primaryKey unused today but kept in imports to signal we may add composite
// keys later (e.g. host_slots).
void primaryKey;
