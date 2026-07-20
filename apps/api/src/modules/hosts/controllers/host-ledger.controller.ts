import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { WalletLedgerService } from "../services/wallet-ledger.service";

const ListLedgerQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

const DailyGrossQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(90).default(30),
  })
  .strict();

@ApiTags("hosts")
@ApiBearerAuth()
@Controller({ path: "hosts/me/ledger" })
export class HostLedgerController {
  constructor(private readonly ledger: WalletLedgerService) {}

  @Get()
  @ApiOperation({
    summary:
      "Immutable hash-chained wallet ledger — every credit + debit against the host wallet, newest first. Powers the dashboard's Recent transactions panel.",
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(ListLedgerQuerySchema))
    query: z.infer<typeof ListLedgerQuerySchema>,
  ) {
    const items = await this.ledger.listForUser(user.sub, query);
    return { items };
  }

  @Get("daily-gross")
  @ApiOperation({
    summary:
      "Daily gross booking + tip credits for the last N days (default 30). One bucket per day. Powers the dashboard bar chart.",
  })
  async dailyGross(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(DailyGrossQuerySchema))
    query: z.infer<typeof DailyGrossQuerySchema>,
  ) {
    const buckets = await this.ledger.dailyGrossByModeForUser(user.sub, query.days);
    return { buckets };
  }
}
