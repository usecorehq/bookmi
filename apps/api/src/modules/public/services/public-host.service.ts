import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import { hostProfiles, services } from "../../../drizzle/schema";
import type { PublicHostView } from "@bookmi/shared-types";

/**
 * Read side of the public page. No auth — anyone hitting bookmi.co/<slug>
 * lands here. Only surfaces active services and never leaks internal fields
 * (host user_id, wallet, bank details).
 */
@Injectable()
export class PublicHostService {
  constructor(@Inject(SUPABASE_DB) private readonly db: SupabaseDb) {}

  async getBySlug(slug: string): Promise<{
    host: PublicHostView;
    services: PublicServiceRow[];
  }> {
    const host = await this.findHostOrThrow(slug);
    const items = await this.db
      .select({
        id: services.id,
        type: services.type,
        slug: services.slug,
        title: services.title,
        description: services.description,
        priceKobo: services.priceKobo,
        durationMinutes: services.durationMinutes,
        payWhatYouWant: services.payWhatYouWant,
      })
      .from(services)
      .where(and(eq(services.hostId, host.id), eq(services.active, true)))
      .orderBy(asc(services.type), desc(services.createdAt));

    return {
      host: this.toPublicView(host),
      services: items as PublicServiceRow[],
    };
  }

  async getServiceBySlugs(
    hostSlug: string,
    serviceSlug: string,
  ): Promise<{ host: PublicHostView; service: PublicServiceRow }> {
    const host = await this.findHostOrThrow(hostSlug);
    const [service] = await this.db
      .select({
        id: services.id,
        type: services.type,
        slug: services.slug,
        title: services.title,
        description: services.description,
        priceKobo: services.priceKobo,
        durationMinutes: services.durationMinutes,
        payWhatYouWant: services.payWhatYouWant,
      })
      .from(services)
      .where(
        and(
          eq(services.hostId, host.id),
          eq(services.slug, serviceSlug),
          eq(services.active, true),
        ),
      )
      .limit(1);
    if (!service) throw new NotFoundException("Service not found on this page.");
    return { host: this.toPublicView(host), service: service as PublicServiceRow };
  }

  private async findHostOrThrow(slug: string) {
    const [host] = await this.db
      .select()
      .from(hostProfiles)
      .where(eq(hostProfiles.slug, slug))
      .limit(1);
    if (!host) throw new NotFoundException("Page not found.");
    return host;
  }

  private toPublicView(host: typeof hostProfiles.$inferSelect): PublicHostView {
    return {
      slug: host.slug,
      displayName: host.displayName,
      bio: host.bio,
      avatarUrl: host.avatarUrl,
      accentColor: host.accentColor,
      operatingHours: host.operatingHours as PublicHostView["operatingHours"],
      phone: host.phone,
      address: host.address,
    };
  }
}

type PublicServiceRow = {
  id: string;
  type: "booking" | "tip";
  slug: string;
  title: string;
  description: string | null;
  priceKobo: number;
  durationMinutes: number | null;
  payWhatYouWant: boolean;
};
