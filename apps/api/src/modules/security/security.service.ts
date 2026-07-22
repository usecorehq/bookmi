import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { createHash, randomInt } from "node:crypto";
import { SUPABASE_DB, type SupabaseDb } from "../../drizzle/drizzle.module";
import { securityChallenges } from "../../drizzle/schema";
import { EmailsService } from "../emails/emails.service";
import type { SecurityChallengePurpose } from "./security.dto";

/** How long a freshly-minted OTP stays valid. */
const OTP_TTL_MS = 5 * 60 * 1000;

/** Max wrong-code attempts before a challenge auto-locks. */
const MAX_ATTEMPTS = 5;

/** Rate-limit window + max non-expired challenges per (user, purpose). */
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 3;

const PURPOSE_LABELS: Record<SecurityChallengePurpose, string> = {
  refund_booking: "refund",
  withdraw_funds: "withdrawal",
  create_paycode: "paycode creation",
  reveal_paycode: "paycode reveal",
};

/**
 * Second-factor gate for money-out operations. Challenges are single-use,
 * SHA256-hashed, and short-lived (5 min). The plaintext code only exists in
 * the user's inbox — even root DB access won't reveal a live OTP.
 *
 * Rate limiting: no more than 3 non-expired challenges per (user, purpose)
 * per hour. This kills a mail-spam scenario where a stolen session mints
 * OTPs to phish the user.
 */
@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);

  constructor(
    @Inject(SUPABASE_DB) private readonly db: SupabaseDb,
    private readonly emails: EmailsService,
  ) {}

  /**
   * Mint a new challenge, email the code, return the id + expiry. Never
   * returns the plaintext — the email is the only place it lives.
   */
  async requestOtp(
    userId: string,
    purpose: SecurityChallengePurpose,
  ): Promise<{ challengeId: string; expiresAt: Date }> {
    // Rate limit: too many recent live challenges = probable abuse.
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recent = await this.db
      .select({ id: securityChallenges.id })
      .from(securityChallenges)
      .where(
        and(
          eq(securityChallenges.userId, userId),
          eq(securityChallenges.purpose, purpose),
          gt(securityChallenges.createdAt, windowStart),
          gt(securityChallenges.expiresAt, new Date()),
          isNull(securityChallenges.consumedAt),
        ),
      );
    if (recent.length >= RATE_LIMIT_MAX) {
      throw new HttpException(
        "Too many OTP requests — wait a few minutes and try again.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 6-digit numeric — leading zeros preserved by pad.
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const codeHash = createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    const [row] = await this.db
      .insert(securityChallenges)
      .values({
        userId,
        purpose,
        codeHash,
        expiresAt,
      })
      .returning({ id: securityChallenges.id });

    if (!row) {
      // Postgres never returns nothing here, but the type is nullable.
      throw new Error("Failed to persist security challenge.");
    }

    // Look up the user's email so the code can reach them. `auth.users` sits
    // outside our bookmi schema — same raw-query technique the booking
    // handler uses to fetch host emails.
    const [emailRow] = await this.db.execute<{ email: string }>(
      sql`SELECT email FROM auth.users WHERE id = ${userId} LIMIT 1`,
    );
    const to = emailRow?.email;
    if (!to) {
      // Deliberately leaves the row in place — a re-request will hit the rate
      // limit and surface the same issue, avoiding a silent no-op.
      this.logger.error(`No email on file for user ${userId} — OTP cannot be delivered.`);
      throw new UnauthorizedException(
        "No email on file — contact support to reset your account.",
      );
    }

    await this.emails.enqueue({
      kind: "security_otp",
      to,
      data: {
        code,
        purpose,
        purposeLabel: PURPOSE_LABELS[purpose],
        expiresInMinutes: Math.round(OTP_TTL_MS / 60_000),
      },
    });

    this.logger.log(
      `Issued ${purpose} OTP ${row.id} for user ${userId} — expires ${expiresAt.toISOString()}`,
    );

    return { challengeId: row.id, expiresAt };
  }

  /**
   * Verify and single-use consume a submitted code. Throws on any failure
   * (missing challenge, expired, wrong code, brute-force lock). Success is a
   * transactional UPDATE that stamps `consumed_at` — a concurrent second
   * attempt sees `consumed_at IS NOT NULL` and re-runs against the next
   * unconsumed row (or fails).
   */
  async verifyAndConsume(
    userId: string,
    purpose: SecurityChallengePurpose,
    code: string,
  ): Promise<void> {
    const [challenge] = await this.db
      .select()
      .from(securityChallenges)
      .where(
        and(
          eq(securityChallenges.userId, userId),
          eq(securityChallenges.purpose, purpose),
          isNull(securityChallenges.consumedAt),
        ),
      )
      .orderBy(desc(securityChallenges.createdAt))
      .limit(1);

    if (!challenge) {
      throw new UnauthorizedException("Request a fresh OTP.");
    }
    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("This OTP has expired.");
    }

    const submittedHash = createHash("sha256").update(code).digest("hex");
    if (submittedHash !== challenge.codeHash) {
      const nextAttempts = challenge.failedAttempts + 1;
      if (nextAttempts >= MAX_ATTEMPTS) {
        // Burn the challenge so a lucky guess on attempt 6 can't succeed.
        await this.db
          .update(securityChallenges)
          .set({
            failedAttempts: nextAttempts,
            consumedAt: new Date(),
          })
          .where(eq(securityChallenges.id, challenge.id));
        throw new UnauthorizedException(
          "Too many wrong codes — request a fresh OTP.",
        );
      }
      await this.db
        .update(securityChallenges)
        .set({ failedAttempts: nextAttempts })
        .where(eq(securityChallenges.id, challenge.id));
      throw new UnauthorizedException("Wrong OTP.");
    }

    // Atomic single-use: only flip if it's still unconsumed. If two threads
    // both submit the same right code, one wins and the other sees a fresh
    // load below.
    const consumed = await this.db
      .update(securityChallenges)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(securityChallenges.id, challenge.id),
          isNull(securityChallenges.consumedAt),
        ),
      )
      .returning({ id: securityChallenges.id });

    if (consumed.length === 0) {
      throw new UnauthorizedException("Request a fresh OTP.");
    }
  }
}
