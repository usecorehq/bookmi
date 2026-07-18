import {
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
} from "class-validator";

export const PURPOSE_TYPES = ["booking_checkout"] as const;
export type PurposeType = (typeof PURPOSE_TYPES)[number];

export class InitiatePaymentDto {
  @IsEnum(PURPOSE_TYPES)
  purposeType!: PurposeType;

  @IsOptional()
  @IsUUID()
  purposeId?: string;

  @IsInt()
  @IsPositive()
  amountMinor!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @IsOptional()
  @IsUUID()
  businessId?: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  callbackUrl?: string;

  /**
   * For guest checkouts, the frontend forwards this so multi-tab / double-click
   * initiates resolve to the same transaction row. Also honored as the
   * `Idempotency-Key` header at the controller level.
   */
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  initiatorUserId?: string;

  @IsOptional()
  @IsEnum(["popup", "checkout_url"])
  checkoutMode?: "popup" | "checkout_url";
}
