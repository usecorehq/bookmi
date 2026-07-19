import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import {
  CreateHostProfileDto,
  CreateHostProfileSchema,
  SlugSchema,
  UpdateHostProfileDto,
  UpdateHostProfileSchema,
} from "../dto/hosts.dto";
import { HostProfileService } from "../services/host-profile.service";

@ApiTags("hosts")
@ApiBearerAuth()
@Controller({ path: "hosts" })
export class HostProfileController {
  constructor(private readonly profiles: HostProfileService) {}

  @Get("me/profile")
  @ApiOperation({ summary: "Return the current user's host profile + wallet summary." })
  async me(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.profiles.findByUserId(user.sub);
    return { profile };
  }

  @Post("me/profile")
  @ApiOperation({
    summary:
      "Create the host profile after signup. Slug uniqueness + reserved-word validation happens server-side.",
  })
  async create(
    @Body(new ZodValidationPipe(CreateHostProfileSchema)) body: CreateHostProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const profile = await this.profiles.createForUser(user.sub, body);
    return { profile };
  }

  @Patch("me/profile")
  @ApiOperation({
    summary:
      "Partial update — profile fields (name, slug, bio, avatar, accent, hours, phone, address) plus wallet bank details. The server splits writes across host_profiles + host_wallets.",
  })
  async update(
    @Body(new ZodValidationPipe(UpdateHostProfileSchema)) body: UpdateHostProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const profile = await this.profiles.updateForUser(user.sub, body);
    return { profile };
  }

  @Get("slug-available")
  @ApiOperation({
    summary:
      "Live availability check. Reserved words + already-taken slugs return { available: false }. Called with debounce from the onboarding + profile pages.",
  })
  async slugAvailable(@Query("slug") slug?: string, @CurrentUser() user?: AuthenticatedUser) {
    if (!slug) throw new BadRequestException("slug query param is required");
    const parsed = SlugSchema.safeParse(slug);
    if (!parsed.success) return { available: false, reason: parsed.error.issues[0]?.message };
    // If the caller already has a profile with THIS slug, treat it as available
    // (so the profile page's own slug isn't shown as taken by itself).
    if (user) {
      const mine = await this.profiles.findByUserId(user.sub);
      if (mine?.slug === parsed.data) return { available: true };
    }
    const available = await this.profiles.isSlugAvailable(parsed.data);
    return { available };
  }
}
