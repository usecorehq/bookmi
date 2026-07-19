import type { Kobo } from "./money.js";

export type ServiceType = "booking" | "tip";

export interface Service {
  id: string;
  hostId: string;
  type: ServiceType;
  slug: string;
  title: string;
  description: string | null;
  priceKobo: Kobo;
  durationMinutes: number | null;
  payWhatYouWant: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceInput {
  type?: ServiceType;
  slug?: string;
  title: string;
  description?: string;
  priceKobo: Kobo;
  durationMinutes?: number;
  payWhatYouWant?: boolean;
}

export interface UpdateServiceInput extends Partial<CreateServiceInput> {
  active?: boolean;
}

export interface PublicServiceView {
  id: string;
  type: ServiceType;
  slug: string;
  title: string;
  description: string | null;
  priceKobo: Kobo;
  durationMinutes: number | null;
  payWhatYouWant: boolean;
}
