import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import {
  CreateServiceDto,
  CreateServiceSchema,
  UpdateServiceDto,
  UpdateServiceSchema,
} from "../dto/hosts.dto";
import { HostServicesService } from "../services/host-services.service";

@ApiTags("hosts")
@ApiBearerAuth()
@Controller({ path: "hosts/me/services" })
export class HostServicesController {
  constructor(private readonly services: HostServicesService) {}

  @Get()
  @ApiOperation({ summary: "List the host's services (most-recent first)." })
  async list(@CurrentUser() user: AuthenticatedUser) {
    const items = await this.services.listForUser(user.sub);
    return { items };
  }

  @Post()
  @ApiOperation({ summary: "Create a new service on the host's page." })
  async create(
    @Body(new ZodValidationPipe(CreateServiceSchema)) body: CreateServiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const service = await this.services.createForUser(user.sub, body);
    return { service };
  }

  @Patch(":id")
  @ApiOperation({ summary: "Partial update — title, price, duration, toggle active/PWYW." })
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateServiceSchema)) body: UpdateServiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const service = await this.services.updateForUser(user.sub, id, body);
    return { service };
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Hard delete a service." })
  async remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.services.deleteForUser(user.sub, id);
  }
}
