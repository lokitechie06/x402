import type { PaymentPayload, PaymentRequirements, SchemeNetworkClient } from "@x402/core/types";
import type { ClientNearSigner } from "../../signer";
import type { ExactNearPayloadV2 } from "../../types";
import { generateNonce } from "../../utils";

/**
 * NEAR client implementation for the Exact payment scheme.
 *
 * Unlike EVM/SVM where the client creates a partial/signed transaction for the facilitator
 * to submit, NEAR requires the client to sign and broadcast the transfer themselves.
 * `createPaymentPayload` executes the on-chain ft_transfer and returns the tx hash as proof.
 */
export class ExactNearScheme implements SchemeNetworkClient {
  readonly scheme = "exact";

  /**
   * @param signer - The NEAR signer for executing ft_transfer
   */
  constructor(private readonly signer: ClientNearSigner) {}

  /**
   * Create a payment payload by executing the ft_transfer on-chain.
   *
   * This method:
   * 1. Generates a random nonce
   * 2. Submits an ft_transfer to the USDC contract with the nonce as memo
   * 3. Returns the transaction hash as proof of payment
   *
   * @param x402Version - The x402 protocol version
   * @param paymentRequirements - The payment requirements from the server
   * @returns Promise resolving to a PaymentPayload
   */
  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    const nonce = generateNonce();

    const txHash = await this.signer.ftTransfer(
      paymentRequirements.asset,
      paymentRequirements.payTo,
      paymentRequirements.amount,
      nonce,
    );

    const payload: ExactNearPayloadV2 = {
      transactionHash: txHash,
      senderId: this.signer.accountId,
      nonce,
    };

    return {
      x402Version,
      payload,
    };
  }
}
