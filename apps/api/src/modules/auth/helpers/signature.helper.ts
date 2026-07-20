import { createHmac, timingSafeEqual } from "crypto";

export function verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, any>,
    secret: string
): boolean {
    const msgId = headers["webhook-id"];
    const msgTimestamp = headers["webhook-timestamp"];
    const msgSignature = headers["webhook-signature"];

    if (
        typeof msgId !== "string" ||
        typeof msgTimestamp !== "string" ||
        typeof msgSignature !== "string"
    ) {
        return false;
    }

    // 1. Prevent replay attacks (e.g., reject messages older than 5 minutes)
    const timestamp = parseInt(msgTimestamp, 10);
    if (isNaN(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
        return false;
    }

    // 2. Re-create the signed content
    const signedContent = `${msgId}.${msgTimestamp}.${rawBody.toString("utf8")}`;

    // 3. Compute the expected HMAC-SHA256 signature
    // Clean up both v1, and whsec_ prefixes
    const cleanSecret = secret.replace("v1,", "").replace("whsec_", "");
    const key = Buffer.from(cleanSecret, "base64");
    const expectedSignature = createHmac("sha256", key)
        .update(signedContent)
        .digest("base64");

    // 4. Compare with the received signatures (handles space-separated v1 signatures)
    const passedSignatures = msgSignature.split(" ");
    try {
        const expectedBuffer = Buffer.from(expectedSignature, "base64");
        for (const sig of passedSignatures) {
            const [version, value] = sig.split(",");
            if (version === "v1" && value) {
                const receivedBuffer = Buffer.from(value, "base64");
                if (
                    expectedBuffer.length === receivedBuffer.length &&
                    timingSafeEqual(expectedBuffer, receivedBuffer)
                ) {
                    return true;
                }
            }
        }
    } catch {
        return false;
    }

    return false;
}
