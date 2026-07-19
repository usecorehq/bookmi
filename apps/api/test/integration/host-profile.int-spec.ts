import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { ConflictException, NotFoundException } from "@nestjs/common";
import * as schema from "../../src/drizzle/schema";
import { HostProfileService } from "../../src/modules/hosts/services/host-profile.service";

/**
 * HostProfileService against a real Postgres. Covers the flows the frontend
 * onboarding + profile page exercise: create, find, slug collision, updates
 * that split into host_profiles + host_wallets.
 */
describe("host profile (integration)", () => {
  const url = process.env.SUPABASE_DB_URL!;
  const client = postgres(url, { max: 5 });
  const db = drizzle(client, { schema });
  const service = new HostProfileService(db);

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("creates a profile and provisions the wallet in one step", async () => {
    const userId = randomUUID();
    const slug = `ada-${randomUUID().slice(0, 8)}`;

    const profile = await service.createForUser(userId, { slug, displayName: "Ada" });
    expect(profile.slug).toBe(slug);

    const found = await service.findByUserId(userId);
    expect(found).not.toBeNull();
    expect(found!.wallet).not.toBeNull();
    expect(found!.wallet!.balanceKobo).toBe(0);
  });

  it("rejects a duplicate slug at creation with 409", async () => {
    const slug = `taken-${randomUUID().slice(0, 8)}`;
    await service.createForUser(randomUUID(), { slug, displayName: "First" });
    await expect(
      service.createForUser(randomUUID(), { slug, displayName: "Second" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects a second profile for the same user", async () => {
    const userId = randomUUID();
    await service.createForUser(userId, {
      slug: `once-${randomUUID().slice(0, 8)}`,
      displayName: "Ada",
    });
    await expect(
      service.createForUser(userId, {
        slug: `twice-${randomUUID().slice(0, 8)}`,
        displayName: "Ada 2",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("isSlugAvailable is false for reserved words and taken slugs", async () => {
    expect(await service.isSlugAvailable("admin")).toBe(false);
    expect(await service.isSlugAvailable("dashboard")).toBe(false);

    const slug = `mine-${randomUUID().slice(0, 8)}`;
    await service.createForUser(randomUUID(), { slug, displayName: "Ada" });
    expect(await service.isSlugAvailable(slug)).toBe(false);
    expect(await service.isSlugAvailable(`fresh-${randomUUID().slice(0, 8)}`)).toBe(true);
  });

  it("allows a host to keep their own slug via isSlugAvailableForHost", async () => {
    const userId = randomUUID();
    const slug = `keeps-${randomUUID().slice(0, 8)}`;
    const profile = await service.createForUser(userId, { slug, displayName: "Ada" });
    expect(await service.isSlugAvailableForHost(slug, profile.id)).toBe(true);
    // A stranger checking the same slug still sees it taken.
    expect(await service.isSlugAvailable(slug)).toBe(false);
  });

  it("patch splits profile fields + bank details between host_profiles and host_wallets", async () => {
    const userId = randomUUID();
    await service.createForUser(userId, {
      slug: `patch-${randomUUID().slice(0, 8)}`,
      displayName: "Ada",
    });
    const updated = await service.updateForUser(userId, {
      bio: "Nail artist in Yaba.",
      accentColor: "#7c3aed",
      phone: "+2348012345678",
      bankCode: "058",
      bankAccountNumber: "0123456789",
      bankAccountName: "Ada Bookings",
    });
    expect(updated.bio).toBe("Nail artist in Yaba.");
    expect(updated.accentColor).toBe("#7c3aed");
    expect(updated.phone).toBe("+2348012345678");
    expect(updated.wallet).not.toBeNull();
    expect(updated.wallet!.bankCode).toBe("058");
    expect(updated.wallet!.bankAccountNumber).toBe("0123456789");
    expect(updated.wallet!.bankAccountName).toBe("Ada Bookings");
  });

  it("patch throws NotFound when the user has no profile yet", async () => {
    await expect(
      service.updateForUser(randomUUID(), { bio: "nope" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("patch rejects a slug collision with another host", async () => {
    const first = await service.createForUser(randomUUID(), {
      slug: `alpha-${randomUUID().slice(0, 8)}`,
      displayName: "Alpha",
    });
    const secondUserId = randomUUID();
    await service.createForUser(secondUserId, {
      slug: `beta-${randomUUID().slice(0, 8)}`,
      displayName: "Beta",
    });
    // Second user tries to steal first's slug.
    await expect(
      service.updateForUser(secondUserId, { slug: first.slug }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
