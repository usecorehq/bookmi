import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from "@nestjs/common";
import type { ZodTypeAny } from "zod";

/**
 * Validate a request body / query / param against a Zod schema and hand the
 * parsed (and coerced) value forward. Failure surfaces as 400 with a
 * per-field `issues` array — nice to render in the frontend without
 * reconstructing paths.
 *
 * Usage:
 *   `@Body(new ZodValidationPipe(InitiatePaymentSchema)) body: InitiatePaymentDto`
 */
@Injectable()
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}
