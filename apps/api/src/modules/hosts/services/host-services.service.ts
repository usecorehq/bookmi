import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import { hostProfiles, services, type Service } from "../../../drizzle/schema";
import { HostProfileService } from "./host-profile.service";

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
      title: string;
      description?: string | null;
      priceKobo: number;
      durationMinutes?: number | null;
      payWhatYouWant?: boolean;
      active?: boolean;
    },
  ): Promise<Service> {
    const host = await this.requireHost(userId);
    const [row] = await this.db
      .insert(services)
      .values({
        hostId: host.id,
        title: input.title,
        description: input.description ?? null,
        priceKobo: input.priceKobo,
        durationMinutes: input.durationMinutes ?? null,
        payWhatYouWant: input.payWhatYouWant ?? false,
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
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.priceKobo !== undefined) patch.priceKobo = input.priceKobo;
    if (input.durationMinutes !== undefined) patch.durationMinutes = input.durationMinutes;
    if (input.payWhatYouWant !== undefined) patch.payWhatYouWant = input.payWhatYouWant;
    if (input.active !== undefined) patch.active = input.active;
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
}
