import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
  CreateHostBookingDto,
  CreateHostBookingSchema,
  ListBookingsQueryDto,
  ListBookingsQuerySchema,
  UpdateHostBookingDto,
  UpdateHostBookingSchema,
} from "../dto/hosts.dto";
import { HostBookingsService } from "../services/host-bookings.service";

@ApiTags("hosts")
@ApiBearerAuth()
@Controller({ path: "hosts/me/bookings" })
export class HostBookingsController {
  constructor(private readonly bookings: HostBookingsService) {}

  @Get()
  @ApiOperation({
    summary:
      "List the host's bookings, filtered by status/source/date/text. Powers the dashboard All Bookings + Calendar views.",
  })
  async list(
    @Query(new ZodValidationPipe(ListBookingsQuerySchema)) query: ListBookingsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const items = await this.bookings.list(user.sub, query);
    return { items };
  }

  @Post()
  @ApiOperation({
    summary:
      "Manually create a booking from the dashboard '+ New Booking' modal. No payment attached; marked source='dashboard', status='confirmed'.",
  })
  async create(
    @Body(new ZodValidationPipe(CreateHostBookingSchema)) body: CreateHostBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const booking = await this.bookings.createManual(user.sub, body);
    return { booking };
  }

  @Get(":id")
  @ApiOperation({ summary: "Fetch a single booking (must belong to the current host)." })
  async get(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const booking = await this.bookings.findByHostAndId(user.sub, id);
    return { booking };
  }

  @Patch(":id")
  @ApiOperation({
    summary:
      "Advance a booking through its lifecycle (arrived → seated → completed, or cancel/no_show). Rejected transitions return 400.",
  })
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateHostBookingSchema)) body: UpdateHostBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const booking = await this.bookings.updateStatus(user.sub, id, body);
    return { booking };
  }
}
