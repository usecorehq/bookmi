import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
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
  RefundBookingDto,
  RefundBookingSchema,
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

  @Post(":id/send-payment-link")
  @ApiOperation({
    summary:
      "Email the customer a unique /pay/:bookingId link that resumes checkout against this pending booking. Rejects non-pending bookings.",
  })
  async sendPaymentLink(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.sendPaymentLink(user.sub, id);
  }

  @Post(":id/refund")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Refund a paid booking to the customer's bank account. Requires x-idempotency-key + x-otp-code headers. Debits the host wallet by `amountKobo` and marks the booking canceled. A retried request with the same idempotency key hits the cached ledger row instead of a second disbursement.",
  })
  async refund(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RefundBookingSchema)) body: RefundBookingDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-otp-code") otpCode: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      throw new BadRequestException(
        "x-idempotency-key header required (8-100 chars).",
      );
    }
    if (!otpCode || !/^\d{6}$/.test(otpCode)) {
      throw new BadRequestException(
        "x-otp-code header required (6 digits).",
      );
    }
    const result = await this.bookings.refundBooking(user.sub, id, {
      ...body,
      idempotencyKey,
      otpCode,
    });
    // Cached failure → surface the stored reason as a 400 so the client can
    // tell the difference from a fresh success.
    if (result.cached && result.refund.status === "failed") {
      throw new BadRequestException(
        result.refund.failureReason ?? "Refund previously failed.",
      );
    }
    if (result.cached && result.refund.status === "processing") {
      res.status(HttpStatus.ACCEPTED);
    }
    return { refund: result.refund, booking: result.booking };
  }
}
