import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../../common/decorators/public.decorator";
import { PublicHostService } from "../services/public-host.service";

@ApiTags("public")
@Public()
@Controller({ path: "public" })
export class PublicHostController {
  constructor(private readonly hosts: PublicHostService) {}

  @Get(":slug")
  @ApiOperation({
    summary: "Public host page — profile + active services (both types).",
  })
  async getHost(@Param("slug") slug: string) {
    return this.hosts.getBySlug(slug);
  }

  @Get(":slug/:serviceSlug")
  @ApiOperation({
    summary: "Public single-service page — direct share link.",
  })
  async getService(
    @Param("slug") slug: string,
    @Param("serviceSlug") serviceSlug: string,
  ) {
    return this.hosts.getServiceBySlugs(slug, serviceSlug);
  }
}
