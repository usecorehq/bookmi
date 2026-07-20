import type { Queue } from "bullmq";
import { EmailsService } from "./emails.service";
import type { EmailJob } from "./emails.types";

const HOST_JOB: EmailJob = {
  kind: "booking_confirmed_host",
  to: "ada@example.com",
  data: {
    hostDisplayName: "Ada",
    customerName: "Aisha Bello",
    customerPhone: "+2348012345678",
    customerEmail: "aisha@example.com",
    services: [{ title: "Facial", priceKobo: 1_200_000, durationMinutes: 45 }],
    slotStartAt: "2026-07-20T11:00:00.000Z",
    amountKobo: 1_200_000,
    netToHostKobo: 1_170_000,
    bookingCode: "X8-GAFJ",
    manageBookingUrl: "http://localhost:5173/dashboard/bookings",
  },
};

describe("EmailsService (producer)", () => {
  let queue: { add: jest.Mock };
  let service: EmailsService;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    service = new EmailsService(queue as unknown as Queue<EmailJob>);
  });

  it("enqueues with kind as job name and full payload, plus retry policy", async () => {
    await service.enqueue(HOST_JOB);

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, payload, opts] = queue.add.mock.calls[0]!;
    expect(name).toBe("booking_confirmed_host");
    expect(payload).toEqual(HOST_JOB);
    expect(opts).toMatchObject({
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 },
    });
    expect(opts.jobId).toBeUndefined();
  });

  it("threads a jobId through for producer-side dedup", async () => {
    await service.enqueue(HOST_JOB, { jobId: "confirm:booking:xyz" });
    const [, , opts] = queue.add.mock.calls[0]!;
    expect(opts.jobId).toBe("confirm:booking:xyz");
  });

  it("threads a delay through for scheduled sends", async () => {
    await service.enqueue(HOST_JOB, { delay: 60_000 });
    const [, , opts] = queue.add.mock.calls[0]!;
    expect(opts.delay).toBe(60_000);
  });
});
