/**
 * Queue names — shared between producers and processors.
 *
 * When adding a queue:
 *   1. Define the constant here.
 *   2. Import + register the producer where it's consumed
 *      (`BullModule.registerQueue({ name })` in the feature module).
 *   3. Add the `@Processor()` class in the same feature module (or split into
 *      a dedicated worker module when we go two-role).
 */
export const QUEUE_EMAILS = "emails";
export const QUEUE_PAYCODE_SWEEP = "paycode-sweep";
