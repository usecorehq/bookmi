import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { HostWallet, Payout } from "@bookmi/shared-types";

export interface WalletView {
  wallet: HostWallet;
  recentBookings: Array<{
    id: string;
    code: string | null;
    customerName: string;
    amountKobo: number;
    netToHostKobo: number;
    slotStartAt: string | null;
    status: string;
    createdAt: string;
  }>;
  recentPayouts: Payout[];
}

export function useHostWallet() {
  return useQuery({
    queryKey: ["host-wallet"],
    queryFn: () => apiFetch<WalletView>("/hosts/me/wallet"),
  });
}
