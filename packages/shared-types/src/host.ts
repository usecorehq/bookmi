export interface HostProfile {
  id: string;
  userId: string;
  slug: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  accentColor: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HostWallet {
  hostId: string;
  monnifyWalletReference: string | null;
  reservedAccountNumber: string | null;
  reservedBankName: string | null;
  balanceKobo: number;
  bankCode: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
}

export interface PublicHostView {
  slug: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  accentColor: string | null;
}
