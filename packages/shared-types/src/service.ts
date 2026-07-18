import type { Kobo } from "./money.js";

export interface Service {
  id: string;
  hostId: string;
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
  title: string;
  description: string | null;
  priceKobo: Kobo;
  durationMinutes: number | null;
  payWhatYouWant: boolean;
}
