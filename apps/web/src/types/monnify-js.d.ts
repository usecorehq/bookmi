declare module "monnify-js" {
  export interface MonnifyInitializePaymentOptions {
    amount: number;
    currency?: string;
    reference: string;
    customerFullName: string;
    customerEmail: string;
    paymentDescription?: string;
    paymentMethods?: string[];
    metadata?: Record<string, unknown>;
    redirectUrl?: string;
    onComplete?: (response: {
      paymentReference?: string;
      transactionReference?: string;
      status?: string;
    }) => void;
    onClose?: (data?: unknown) => void;
  }

  export default class Monnify {
    constructor(apiKey: string, contractCode: string);
    initializePayment(options: MonnifyInitializePaymentOptions): void;
  }
}
