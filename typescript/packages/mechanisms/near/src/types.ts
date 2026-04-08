/**
 * Exact NEAR payload structure for x402 v2.
 *
 * Because NEAR does not support partial transaction signing, the client
 * submits the payment transaction before presenting proof to the facilitator.
 * This payload carries the proof of the already-executed on-chain transfer.
 */
export type ExactNearPayloadV2 = {
  /**
   * Base58-encoded NEAR transaction hash of the submitted ft_transfer transaction.
   * Used by the facilitator to look up and verify the transfer on-chain.
   */
  transactionHash: string;

  /**
   * NEAR account ID of the payer (transaction signer).
   * Required by the NEAR RPC to look up transaction status.
   */
  senderId: string;

  /**
   * 16-byte random nonce, hex-encoded (32 characters).
   * Included as the `memo` argument of the ft_transfer call.
   * Used by the facilitator to prevent replay attacks.
   */
  nonce: string;
};

/**
 * Decoded ft_transfer call arguments from a NEAR transaction
 */
export type FtTransferArgs = {
  receiver_id: string;
  amount: string;
  memo?: string;
};
