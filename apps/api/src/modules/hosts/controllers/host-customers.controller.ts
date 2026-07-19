import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../../common/decorators/current-user.decorator";
import { CustomersService } from "../services/customers.service";

@ApiTags("hosts")
@ApiBearerAuth()
@Controller({ path: "hosts/me/customers" })
export class HostCustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiOperation({
    summary:
      "List or search the host's customers. Pass ?q=NAME_OR_PHONE_OR_EMAIL for autocomplete on the '+ New Booking' modal.",
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("q") q?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    if (q && q.trim().length >= 2) {
      const items = await this.customers.searchForUser(user.sub, q);
      return { items };
    }
    const items = await this.customers.listForUser(user.sub, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { items };
  }

  @Get(":id")
  @ApiOperation({ summary: "Read a single customer's detail row." })
  async get(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const customer = await this.customers.getByIdForUser(user.sub, id);
    return { customer };
  }

  @Get(":id/bookings")
  @ApiOperation({
    summary: "List every booking (including tips) this customer has made with the host.",
  })
  async bookings(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const items = await this.customers.getBookingsForCustomer(user.sub, id);
    return { items };
  }
}
