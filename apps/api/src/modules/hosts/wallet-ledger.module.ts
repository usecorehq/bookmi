import { Module } from "@nestjs/common";
import { WalletLedgerService } from "./services/wallet-ledger.service";

/**
 * Standalone module so both HostsModule and PaymentsModule can pull in the
 * ledger without a circular import (HostsModule already imports
 * PaymentsModule for the payments-provider registry).
 */
@Module({
  providers: [WalletLedgerService],
  exports: [WalletLedgerService],
})
export class WalletLedgerModule {}
