import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { WalletLedgerService } from "../services/wallet-ledger.service";

const LEDGER_TYPES = ["credit", "debit"] as const;
const LEDGER_SOURCE_TYPES = [
  "payment_transaction",
  "payout",
  "refund",
  "reserved_account",
  "paycode",
] as const;
const LEDGER_SOURCE_MODES = [
  "booking",
  "tip",
  "withdrawal",
  "refund",
  "wallet_topup",
  "paycode_redemption",
] as const;
const LEDGER_STATUSES = ["pending", "success", "failed", "cancelled"] as const;

const ListLedgerQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
    type: z.enum(LEDGER_TYPES).optional(),
    sourceType: z.enum(LEDGER_SOURCE_TYPES).optional(),
    sourceMode: z.enum(LEDGER_SOURCE_MODES).optional(),
    status: z.enum(LEDGER_STATUSES).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
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
      "Immutable hash-chained wallet ledger — every credit + debit against the host wallet, newest first. Powers the dashboard's Recent transactions widget and the full Transactions statement-of-account page. Optional type/sourceType/sourceMode/status/from/to filters; response includes `total` for page-count rendering.",
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(ListLedgerQuerySchema))
    query: z.infer<typeof ListLedgerQuerySchema>,
  ) {
    const { limit, offset, ...filters } = query;
    const { items, total } = await this.ledger.listForUser(user.sub, {
      limit,
      offset,
      ...filters,
      from: filters.from ? new Date(filters.from) : undefined,
      to: filters.to ? new Date(filters.to) : undefined,
    });
    return { items, total };
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
