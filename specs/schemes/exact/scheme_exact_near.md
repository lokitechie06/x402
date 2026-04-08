# Exact Payment Scheme for NEAR Protocol (`exact`)

This document specifies the `exact` payment scheme for the x402 protocol on NEAR.

This scheme facilitates payments of a specific amount of a NEP-141 fungible token (primarily USDC)
on the NEAR blockchain.

## Scheme Name

`exact`

## Overview

NEAR Protocol uses an account-based model where the transaction signer must be the source of funds.
Unlike EVM (EIP-3009) or SVM (partial signing), NEAR does not natively support delegated token
transfers without deploying a custom smart contract.

Because of this, the **NEAR `exact` scheme uses a client-settles model**:
the client signs **and submits** the payment transaction themselves, then presents the
on-chain transaction hash to the facilitator for verification. The facilitator's role is
verification-only — it confirms the payment occurred on-chain with the correct parameters before
allowing access to the resource.

## Protocol Flow

1.  **Client** makes a request to a **Resource Server**.
2.  **Resource Server** responds with a payment required signal containing `PaymentRequired`.
    The `payTo` field is the **merchant's NEAR account ID** (e.g. `merchant.near`).
3.  **Client** creates and signs a NEAR transaction that calls `ft_transfer` on the NEP-141
    USDC contract, transferring the required amount to `payTo`.
    - A random 16-byte nonce (hex-encoded) MUST be included as the `memo` argument.
    - 1 yoctoNEAR MUST be attached as a deposit (required by NEP-141 security model).
4.  **Client** submits the transaction to the NEAR network and waits for confirmation.
5.  **Client** constructs a `PaymentPayload` containing the transaction hash, nonce, and
    their NEAR account ID, then sends a new request to the resource server with this payload.
6.  **Resource Server** forwards the `PaymentPayload` and `PaymentRequirements` to the
    **Facilitator Server's** `/verify` endpoint.
7.  **Facilitator** fetches the transaction from the NEAR RPC using the transaction hash and
    sender account ID.
8.  **Facilitator** inspects the transaction to ensure it is valid and matches the requirements.
9.  **Facilitator** returns a `VerifyResponse` to the **Resource Server**.
10. **Resource Server**, upon successful verification, forwards the payload to the facilitator's
    `/settle` endpoint.
11. **Facilitator** re-verifies and returns a `SettleResponse` containing the transaction hash.
12. **Resource Server** grants the **Client** access to the resource in its response.

> **Note**: Because the payment is already on-chain before verification, `settle` is
> confirmation-only and is idempotent. The facilitator does not submit any transactions.

## `PaymentRequirements` for `exact`

```json
{
  "scheme": "exact",
  "network": "near:mainnet",
  "amount": "1000000",
  "asset": "17208628f84f5d6ad33f0da3bbbeb27ffed7bc96e875c955409ce0a82620f408",
  "payTo": "merchant.near",
  "maxTimeoutSeconds": 300
}
```

- `network`: CAIP-2 network identifier (`near:mainnet` or `near:testnet`).
- `amount`: The exact token amount in the token's smallest unit (USDC has 6 decimals, so
  `1000000` = 1.00 USDC).
- `asset`: The NEP-141 token contract account ID. For USDC on mainnet this is
  `17208628f84f5d6ad33f0da3bbbeb27ffed7bc96e875c955409ce0a82620f408`.
- `payTo`: The recipient NEAR account ID. The resource server operator's account, which must
  be registered with the token contract (via `storage_deposit`) before receiving payments.
- `maxTimeoutSeconds`: Maximum age of the transaction (in seconds) relative to the time the
  facilitator processes the verify request. Transactions older than this limit MUST be rejected.

## `PaymentPayload` `payload` Field

The `payload` field of the `PaymentPayload` contains:

```json
{
  "transactionHash": "FvV7QXPW2JKhNMBYi5hHbUvEdGpNj7z7fFcKhbVp6W1",
  "senderId": "payer.near",
  "nonce": "a3f7c2d891e04b6f"
}
```

- `transactionHash`: The base58-encoded hash of the submitted NEAR transaction.
- `senderId`: The NEAR account ID that signed and submitted the transaction.
- `nonce`: The 16-byte hex-encoded random nonce that was included as the `memo` argument in
  the `ft_transfer` call.

Full `PaymentPayload` object:

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://example.com/api/data",
    "description": "Access to protected content",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "exact",
    "network": "near:mainnet",
    "amount": "1000000",
    "asset": "17208628f84f5d6ad33f0da3bbbeb27ffed7bc96e875c955409ce0a82620f408",
    "payTo": "merchant.near",
    "maxTimeoutSeconds": 300
  },
  "payload": {
    "transactionHash": "FvV7QXPW2JKhNMBYi5hHbUvEdGpNj7z7fFcKhbVp6W1",
    "senderId": "payer.near",
    "nonce": "a3f7c2d891e04b6f"
  }
}
```

## `SettlementResponse`

```json
{
  "success": true,
  "transaction": "FvV7QXPW2JKhNMBYi5hHbUvEdGpNj7z7fFcKhbVp6W1",
  "network": "near:mainnet",
  "payer": "payer.near"
}
```

## Facilitator Verification Rules (MUST)

A facilitator verifying an `exact`-scheme NEAR payment MUST enforce all of the following:

### 1. Payload structure

- The `payload` MUST contain `transactionHash`, `senderId`, and `nonce`.
- `transactionHash` MUST be a valid base58 NEAR transaction hash (44 characters).
- `senderId` MUST be a valid NEAR account ID.
- `nonce` MUST be a 16-byte hex string (32 hex characters).

### 2. On-chain transaction existence

- The facilitator MUST fetch the transaction using `tx(transactionHash, senderId)` from the
  NEAR RPC for the appropriate network.
- If the transaction is not found or the RPC call fails, the payment MUST be rejected.

### 3. Transaction outcome

- The top-level `status` of the transaction outcome MUST be `{ "SuccessValue": "" }`.
- Any other status (e.g. `Failure`, `Unknown`) MUST cause rejection.

### 4. Transaction structure

- `transaction.signer_id` MUST equal `payload.senderId`.
- `transaction.receiver_id` MUST equal `requirements.asset` (the NEP-141 token contract).
- The transaction MUST contain exactly one `FunctionCall` action.
- That `FunctionCall.method_name` MUST be `"ft_transfer"`.

### 5. Transfer arguments

The `FunctionCall.args` field (base64-decoded and JSON-parsed) MUST satisfy:

- `args.receiver_id` MUST equal `requirements.payTo`.
- `args.amount` MUST equal `requirements.amount` (as a string).
- `args.memo` MUST equal `payload.nonce`.

### 6. Transaction age

- The facilitator MUST fetch the block referenced by `transaction_outcome.block_hash`.
- The block `timestamp` (in nanoseconds) converted to seconds MUST be within
  `requirements.maxTimeoutSeconds` of the current time.
- Transactions that are too old MUST be rejected.

### 7. Network match

- The network in `payload.accepted.network` MUST equal `requirements.network`.
- The facilitator MUST use the correct RPC endpoint for the network.

## Duplicate Settlement Mitigation (RECOMMENDED)

### Vulnerability

A resource server may forward the same `PaymentPayload` to the facilitator's `/settle` endpoint
multiple times (e.g. due to retries). Because the NEAR transaction is already on-chain, the
facilitator would return success each time, potentially granting access to a resource multiple
times for a single payment.

### Recommended Mitigation

Facilitators SHOULD maintain a short-term in-memory cache of seen transaction hashes:

1. On verify/settle, derive the cache key from `payload.transactionHash`.
2. If the key is already in the cache, reject with `"duplicate_settlement"`.
3. Insert the key into the cache on first use.
4. Evict entries older than `maxTimeoutSeconds × 2` (or at minimum 120 seconds).

This prevents replay attacks where the same transaction is used to access multiple resources.

## Token Storage Registration (MUST — Server Operators)

NEAR's NEP-141 standard requires accounts to register with a token contract before receiving
tokens. Resource server operators (`payTo` accounts) MUST call `storage_deposit` on the USDC
contract before accepting payments:

```bash
near call 17208628f84f5d6ad33f0da3bbbeb27ffed7bc96e875c955409ce0a82620f408 \
  storage_deposit '{"account_id": "merchant.near"}' \
  --deposit 0.00125 --accountId merchant.near
```

Clients do not need to be pre-registered — the `ft_transfer` call will fail if the recipient
is not registered, and the facilitator will reject the payment.

## Default Assets

| Network        | Token | Contract Account ID                                              | Decimals |
|----------------|-------|------------------------------------------------------------------|----------|
| `near:mainnet` | USDC  | `17208628f84f5d6ad33f0da3bbbeb27ffed7bc96e875c955409ce0a82620f408` | 6        |
| `near:testnet` | USDC  | `usdc.fakes.testnet`                                             | 6        |

## Appendix

### CAIP-2 Network Identifiers

| Network   | CAIP-2 Identifier |
|-----------|-------------------|
| Mainnet   | `near:mainnet`    |
| Testnet   | `near:testnet`    |

### Key Differences from EVM/SVM

| Aspect                | EVM                         | SVM                              | NEAR                                 |
|-----------------------|-----------------------------|----------------------------------|--------------------------------------|
| Signing model         | Client signs EIP-3009 auth  | Client partially signs tx        | Client signs + submits full tx       |
| Facilitator role      | Submits `transferWithAuth`  | Co-signs as fee payer + submits  | Verification only                    |
| Gas payment           | Facilitator pays gas        | Facilitator pays gas (fee payer) | Client pays gas                      |
| Settlement            | Facilitator-initiated       | Facilitator-initiated            | Client-initiated                     |
| Nonce/replay defense  | EIP-3009 nonce + deadline   | Unique blockhash + memo nonce    | Transaction hash + memo nonce        |
