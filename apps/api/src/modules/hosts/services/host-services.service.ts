import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, ne } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import { hostProfiles, services, type Service } from "../../../drizzle/schema";
import { HostProfileService } from "./host-profile.service";

type ServiceType = "booking" | "tip";

@Injectable()
export class HostServicesService {
  constructor(
    @Inject(SUPABASE_DB) private readonly db: SupabaseDb,
    private readonly profiles: HostProfileService,
  ) {}

  async listForUser(userId: string): Promise<Service[]> {
    const host = await this.requireHost(userId);
    return this.db
      .select()
      .from(services)
      .where(eq(services.hostId, host.id))
      .orderBy(desc(services.createdAt));
  }

  async createForUser(
    userId: string,
    input: {
      type?: ServiceType;
      slug?: string;
      title: string;
      description?: string | null;
      priceKobo: number;
      durationMinutes?: number | null;
      payWhatYouWant?: boolean;
      active?: boolean;
    },
  ): Promise<Service> {
    const host = await this.requireHost(userId);
    const type = input.type ?? "booking";
    const slug = input.slug
      ? await this.ensureSlugFree(host.id, input.slug)
      : await this.nextAvailableSlug(host.id, slugify(input.title));

    // Tips are always PWYW conceptually; force it on so the wizard branches
    // correctly regardless of what the client sent.
    const payWhatYouWant = type === "tip" ? true : input.payWhatYouWant ?? false;

    const [row] = await this.db
      .insert(services)
      .values({
        hostId: host.id,
        type,
        slug,
        title: input.title,
        description: input.description ?? null,
        priceKobo: input.priceKobo,
        durationMinutes: type === "tip" ? null : input.durationMinutes ?? null,
        payWhatYouWant,
        active: input.active ?? true,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create service.");
    return row;
  }

  async updateForUser(
    userId: string,
    serviceId: string,
    input: Partial<{
      type: ServiceType;
      slug: string;
      title: string;
      description: string | null;
      priceKobo: number;
      durationMinutes: number | null;
      payWhatYouWant: boolean;
      active: boolean;
    }>,
  ): Promise<Service> {
    const host = await this.requireHost(userId);
    const patch: Partial<typeof services.$inferInsert> = {};
    if (input.type !== undefined) patch.type = input.type;
    if (input.slug !== undefined) {
      patch.slug = await this.ensureSlugFree(host.id, input.slug, serviceId);
    }
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.priceKobo !== undefined) patch.priceKobo = input.priceKobo;
    if (input.durationMinutes !== undefined) patch.durationMinutes = input.durationMinutes;
    if (input.payWhatYouWant !== undefined) patch.payWhatYouWant = input.payWhatYouWant;
    if (input.active !== undefined) patch.active = input.active;
    // Tips have no duration and are always PWYW.
    if (patch.type === "tip") {
      patch.durationMinutes = null;
      patch.payWhatYouWant = true;
    }
    patch.updatedAt = new Date();

    const [row] = await this.db
      .update(services)
      .set(patch)
      .where(and(eq(services.id, serviceId), eq(services.hostId, host.id)))
      .returning();
    if (!row) throw new NotFoundException("Service not found.");
    return row;
  }

  async deleteForUser(userId: string, serviceId: string): Promise<void> {
    const host = await this.requireHost(userId);
    const result = await this.db
      .delete(services)
      .where(and(eq(services.id, serviceId), eq(services.hostId, host.id)))
      .returning({ id: services.id });
    if (result.length === 0) throw new NotFoundException("Service not found.");
  }

  private async requireHost(userId: string) {
    const [host] = await this.db
      .select({ id: hostProfiles.id })
      .from(hostProfiles)
      .where(eq(hostProfiles.userId, userId))
      .limit(1);
    if (!host) throw new NotFoundException("Complete onboarding before managing services.");
    return host;
  }

  /**
   * Find the next `<base>[-N]` that's free for this host. `base` is already
   * slugified; N starts at 2 (`base`, then `base-2`, `base-3`, …).
   */
  private async nextAvailableSlug(hostId: string, base: string): Promise<string> {
    const seed = base || "service";
    for (let i = 0; i < 100; i++) {
      const candidate = i === 0 ? seed : `${seed}-${i + 1}`;
      const [existing] = await this.db
        .select({ id: services.id })
        .from(services)
        .where(and(eq(services.hostId, hostId), eq(services.slug, candidate)))
        .limit(1);
      if (!existing) return candidate;
    }
    throw new BadRequestException("Couldn't find a free slug — try renaming.");
  }

  /** Same-host uniqueness check for explicit slug edits. */
  private async ensureSlugFree(
    hostId: string,
    slug: string,
    excludeServiceId?: string,
  ): Promise<string> {
    const where = excludeServiceId
      ? and(
          eq(services.hostId, hostId),
          eq(services.slug, slug),
          ne(services.id, excludeServiceId),
        )
      : and(eq(services.hostId, hostId), eq(services.slug, slug));
    const [clash] = await this.db.select({ id: services.id }).from(services).where(where).limit(1);
    if (clash) throw new ConflictException(`Slug "${slug}" is already used on your page.`);
    return slug;
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
