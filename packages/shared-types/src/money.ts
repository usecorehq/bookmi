/**
 * All monetary values in the domain are stored and transmitted in kobo
 * (1 NGN = 100 kobo) as integers to avoid floating-point rounding.
 */
export type Kobo = number;

export const KOBO_PER_NAIRA = 100;
