export interface DayHours {
  /** HH:mm 24-hour, e.g. "09:00". */
  open: string;
  /** HH:mm 24-hour, e.g. "18:00". */
  close: string;
  closed: boolean;
}

export interface OperatingHours {
  monday: DayHours;
  tuesday: DayHours;
  wednesday: DayHours;
  thursday: DayHours;
  friday: DayHours;
  saturday: DayHours;
  sunday: DayHours;
}

export interface HostProfile {
  id: string;
  userId: string;
  slug: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  accentColor: string | null;
  operatingHours: OperatingHours;
  phone: string | null;
  address: string | null;
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

/** What the public /:slug page sees. */
export interface PublicHostView {
  slug: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  accentColor: string | null;
  operatingHours: OperatingHours;
  phone: string | null;
  address: string | null;
}
