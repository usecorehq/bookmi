import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { eq, ne, and } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import { hostProfiles, hostWallets, type HostProfile, type HostWallet } from "../../../drizzle/schema";
import { RESERVED_SLUGS } from "../dto/hosts.dto";

/**
 * host_profiles + host_wallets are the two write targets for the host's
 * public identity + banking info. This service owns both so PATCH /profile
 * can update fields from either table in a single API call from the frontend.
 */
@Injectable()
export class HostProfileService {
  constructor(@Inject(SUPABASE_DB) private readonly db: SupabaseDb) {}

  async findByUserId(userId: string): Promise<(HostProfile & { wallet: HostWallet | null }) | null> {
    const [profile] = await this.db
      .select()
      .from(hostProfiles)
      .where(eq(hostProfiles.userId, userId))
      .limit(1);
    if (!profile) return null;
    const [wallet] = await this.db
      .select()
      .from(hostWallets)
      .where(eq(hostWallets.hostId, profile.id))
      .limit(1);
    return { ...profile, wallet: wallet ?? null };
  }

  async findBySlug(slug: string): Promise<HostProfile | null> {
    const [profile] = await this.db
      .select()
      .from(hostProfiles)
      .where(eq(hostProfiles.slug, slug))
      .limit(1);
    return profile ?? null;
  }

  /**
   * True if the slug is not taken AND not reserved. Reserved list is checked
   * client-side too (in the Zod schema) but we re-check here so this endpoint
   * is trustworthy on its own.
   */
  async isSlugAvailable(slug: string): Promise<boolean> {
    if (RESERVED_SLUGS.has(slug)) return false;
    const [existing] = await this.db
      .select({ id: hostProfiles.id })
      .from(hostProfiles)
      .where(eq(hostProfiles.slug, slug))
      .limit(1);
    return !existing;
  }

  /** Same as isSlugAvailable, but excludes `selfHostId` — for edits. */
  async isSlugAvailableForHost(slug: string, selfHostId: string): Promise<boolean> {
    if (RESERVED_SLUGS.has(slug)) return false;
    const [existing] = await this.db
      .select({ id: hostProfiles.id })
      .from(hostProfiles)
      .where(and(eq(hostProfiles.slug, slug), ne(hostProfiles.id, selfHostId)))
      .limit(1);
    return !existing;
  }

  async createForUser(userId: string, input: { slug: string; displayName: string }): Promise<HostProfile> {
    if (!(await this.isSlugAvailable(input.slug))) {
      throw new ConflictException("That slug is already taken.");
    }
    // Trap for duplicate signup runs — user already has a profile.
    const existing = await this.findByUserId(userId);
    if (existing) throw new ConflictException("You already have a Bookmi page.");

    try {
      const [profile] = await this.db
        .insert(hostProfiles)
        .values({ userId, slug: input.slug, displayName: input.displayName })
        .returning();
      if (!profile) throw new BadRequestException("Failed to create profile.");
      // Provision the wallet row immediately so subsequent credits don't race.
      await this.db.insert(hostWallets).values({ hostId: profile.id }).onConflictDoNothing();
      return profile;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException("That slug is already taken.");
      throw err;
    }
  }

  async updateForUser(
    userId: string,
    input: {
      slug?: string;
      displayName?: string;
      bio?: string | null;
      avatarUrl?: string | null;
      accentColor?: string | null;
      operatingHours?: Record<string, unknown>;
      phone?: string | null;
      address?: string | null;
      bankCode?: string | null;
      bankAccountNumber?: string | null;
      bankAccountName?: string | null;
    },
  ): Promise<HostProfile & { wallet: HostWallet | null }> {
    const current = await this.findByUserId(userId);
    if (!current) throw new NotFoundException("Profile not found. Complete onboarding first.");

    if (input.slug && input.slug !== current.slug) {
      const ok = await this.isSlugAvailableForHost(input.slug, current.id);
      if (!ok) throw new ConflictException("That slug is already taken.");
    }

    const profilePatch: Partial<typeof hostProfiles.$inferInsert> = {};
    if (input.slug !== undefined) profilePatch.slug = input.slug;
    if (input.displayName !== undefined) profilePatch.displayName = input.displayName;
    if (input.bio !== undefined) profilePatch.bio = input.bio;
    if (input.avatarUrl !== undefined) profilePatch.avatarUrl = input.avatarUrl;
    if (input.accentColor !== undefined) profilePatch.accentColor = input.accentColor;
    if (input.operatingHours !== undefined) profilePatch.operatingHours = input.operatingHours;
    if (input.phone !== undefined) profilePatch.phone = input.phone;
    if (input.address !== undefined) profilePatch.address = input.address;

    const walletPatch: Partial<typeof hostWallets.$inferInsert> = {};
    if (input.bankCode !== undefined) walletPatch.bankCode = input.bankCode;
    if (input.bankAccountNumber !== undefined) walletPatch.bankAccountNumber = input.bankAccountNumber;
    if (input.bankAccountName !== undefined) walletPatch.bankAccountName = input.bankAccountName;

    try {
      if (Object.keys(profilePatch).length > 0) {
        profilePatch.updatedAt = new Date();
        await this.db.update(hostProfiles).set(profilePatch).where(eq(hostProfiles.id, current.id));
      }
      if (Object.keys(walletPatch).length > 0) {
        walletPatch.updatedAt = new Date();
        await this.db
          .insert(hostWallets)
          .values({ hostId: current.id, ...walletPatch })
          .onConflictDoUpdate({ target: hostWallets.hostId, set: walletPatch });
      }
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException("That slug is already taken.");
      throw err;
    }

    const updated = await this.findByUserId(userId);
    if (!updated) throw new NotFoundException("Profile disappeared mid-update.");
    return updated;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
