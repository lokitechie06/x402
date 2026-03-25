# Scheme: `session`

## Summary

The `session` scheme enables high-frequency, pay-as-you-go payments over unidirectional payment channels. Clients deposit funds into an onchain escrow contract, then sign off-chain **cumulative vouchers** as they consume resources. The server (facilitator) verifies vouchers with pure signature checks and settles periodically in batches via the facilitator.

## Example Use Cases

- An AI agent making repeated tool calls at a fixed price per call
- High-frequency data feeds with per-query pricing
- Content access metered by page or document

## Design Rationale

The `exact` scheme settles every request onchain. This is appropriate for one-off purchases but introduces per-request latency and gas costs that become prohibitive at scale. The `session` scheme amortizes onchain costs across many requests by separating **authorization** (off-chain voucher signatures) from **settlement** (onchain batch transactions).


## Core Properties (MUST)

The `session` scheme MUST enforce the following properties across ALL network implementations:

### 1. Cumulative Monotonic Vouchers

Each voucher carries a `cumulativeAmount` that MUST be strictly greater than the previous voucher's amount. The increment between consecutive vouchers MUST equal the per-request price. Vouchers are not individually redeemable, only the highest voucher matters for settlement.

### 2. Channel Deposit Model

Clients deposit funds into an onchain escrow (channel) before consuming resources. The deposit is refundable: upon channel close, the unsettled remainder returns to the client. Deposits can be topped up without closing the channel.

### 3. Batched Onchain Settlement

Settlement is deferred at the server's discretion. The server accumulates vouchers off-chain and settles when economically optimal (e.g. threshold-based, periodic, or on close).

---

## Protocol Flow

### First Request (Channel Open)

The server returns a 402 with no `channelId`, signaling a new channel must be opened. The client signs a token authorization (for the deposit) and a first voucher, then retries with a `channelOpen` payload.

```
Client                      Server                   Facilitator           Blockchain
  |-- GET /resource -------->|                             |                     |
  |<-- 402 + PaymentRequired-|                             |                     |
  |   (scheme:session, no channelId)                       |                     |
  |                          |                             |                     |
  | [signs token authorization + first voucher]            |                     |
  |-- GET /resource + PAYMENT-SIGNATURE ----------------->|                      |
  |   (payload.type = channelOpen)                         |                     |
  |                          |-- POST /verify ------------>|  (validate deposit  |
  |                          |<-- {isValid} ---------------|   auth + voucher)   |
  |                          |-- POST /settle ------------>|-- open channel ---->|
  |                          |<-- {channelId, tx} ---------|                     |
  |<-- 200 + resource -------|                             |                     |
  |   + PAYMENT-RESPONSE (channelId, cumulativeAmount)     |                     |
```

### Subsequent Requests (Voucher)

The server returns a 402 with fresh `PaymentRequirements` containing `extra.channelId`, `extra.cumulativeAmount`, and the `amount` for this request. The client echoes `accepted` and includes a signed voucher.

```
Client                      Server                   Facilitator
  |-- GET /resource -------->|                              |
  |<-- 402 + PaymentRequired-|                              |
  |   (scheme:session, extra.channelId, extra.cumulativeAmount, amount)
  |                          |                              |
  | [signs voucher: cumulativeAmount = extra.cumulativeAmount + amount]
  |-- GET /resource + PAYMENT-SIGNATURE ---------------->|
  |   (payload.type = voucher)                           |
  |                          |-- POST /verify ---------->| (signature check only)
  |                          |<-- {isValid} -------------|
  |<-- 200 + resource -------|                           |
  |   + PAYMENT-RESPONSE (cumulativeAmount updated)      |
```

### Top-Up (Deposit Exhausted)

When `extra.cumulativeAmount + amount > extra.deposit` in the 402 response, the client knows a top-up is required. It signs a token authorization for the additional deposit and a new voucher, then retries with a `topUp` payload.

```
Client                      Server                   Facilitator           Blockchain
  |-- GET /resource -------->|                              |                     |
  |<-- 402 + PaymentRequired-|                              |                     |
  |   (extra.channelId, extra.cumulativeAmount, extra.deposit, amount)            |
  | [cumulativeAmount + amount > deposit — top-up required] |                     |
  | [signs token authorization + new voucher]               |                     |
  |-- GET /resource + PAYMENT-SIGNATURE ------------------>|                      |
  |   (payload.type = topUp)                               |                      |
  |                            |-- POST /verify ---------->| (validate top-up    |
  |                            |<-- {isValid} ------------|   auth + voucher)    |
  |                            |-- POST /settle ---------->|-- top up channel -->|
  |                            |<-- {tx} -----------------|                      |
  |<-- 200 + resource ---------|                           |                     |
  |   + PAYMENT-RESPONSE (updated deposit, cumulativeAmount)|                     |
```

### Close (Client-Initiated via Payload Flag)

The client includes `requestClose: true` in a voucher payload. The server processes the request normally, then instructs the facilitator to close the channel:

```
Client                      Server                   Facilitator           Blockchain
  |-- GET /resource + PAYMENT-SIGNATURE -------------->|                      |
  |   (payload.type = voucher, requestClose = true)    |                      |
  |                          |-- POST /verify -------->| (signature check)    |
  |                          |<-- {isValid} -----------|                      |
  |                          |-- POST /settle -------->|-- close channel ---->|
  |                          |<-- {tx} ---------------|                       |
  |<-- 200 + resource -------|                         |                      |
```

---

## State Management

The server is the sole owner of session state. The facilitator is stateless. All session context is included in the payment payload (`accepted.extra`) or can be retrieved from onchain channel state.

### Server State

The server MUST maintain the following per open channel:

| State Field            | Type      | Description                                                |
| :--------------------- | :-------- | :--------------------------------------------------------- |
| `channelId`            | `bytes32` | Channel identifier                                         |
| `lastCumulativeAmount` | `uint128` | Highest cumulative amount from a verified voucher          |
| `lastSignature`        | `bytes`   | Signature corresponding to `lastCumulativeAmount`          |
| `deposit`              | `uint128` | Current channel deposit (updated on top-up)                |
| `settled`              | `uint128` | Amount already settled onchain                             |

---

## Verification Rules (MUST)

A facilitator verifying a `session`-scheme payment MUST enforce:

1. **Signature validity**: The voucher signature MUST recover to an authorized signer for the channel.
2. **Channel existence**: For `voucher` and `topUp` payloads, the channel MUST exist and not be finalized. For `channelOpen`, the channel MUST NOT already exist.
3. **Payee match**: The channel payee MUST equal `paymentRequirements.payTo`.
4. **Token match**: The channel token MUST equal `paymentRequirements.asset`.
5. **Settler match**: The channel's authorized settler MUST equal the facilitator's own signer address.
6. **Amount monotonicity**: `cumulativeAmount` MUST be strictly greater than `accepted.extra.cumulativeAmount` (the server's last-known cumulative amount, echoed from the 402 response).
7. **Amount increment**: The delta (`cumulativeAmount - accepted.extra.cumulativeAmount`) MUST equal `paymentRequirements.amount`.
8. **Deposit sufficiency**: For `voucher` payloads, `cumulativeAmount` MUST be ≤ `channel.deposit` (read from onchain state). For `topUp` payloads, `cumulativeAmount` MUST be ≤ `channel.deposit + topUp.additionalDeposit`.
9. **Channel not expired**: If a close has been requested and the grace period has elapsed, the channel MUST be rejected.

These checks are security-critical. Implementations MAY introduce stricter limits but MUST NOT relax the above constraints.

---

## Settlement Strategy

The resource server controls when and how often onchain settlement occurs:

| Strategy            | Description                                                    | Trade-off                          |
| :------------------ | :------------------------------------------------------------- | :--------------------------------- |
| **Periodic**        | Settle every N minutes                                         | Predictable gas costs              |
| **Threshold**       | Settle when unsettled amount exceeds T                         | Bounds server's risk exposure      |
| **On close**        | Settle only when closing the channel                           | Minimum gas, maximum risk window   |

---

## Optimistic Path (Optional Client Optimization)

For fixed-price scenarios where the `amount` is constant across requests, a client MAY skip the 402 round trip and proactively send a voucher:

- The client reuses the previous 402's `accepted` requirements and computes `cumulativeAmount` from `PAYMENT-RESPONSE.extra.cumulativeAmount + amount`.
- The server MUST accept proactive vouchers (no 402 required) if the voucher is valid.
- If the proactive voucher has the wrong amount (e.g., the price changed), the server returns a 402 with the correct price and the client retries.

---

## Error Codes

In addition to the standard x402 error codes, the `session` scheme defines:

| Error Code                          | Description                                                        |
| :---------------------------------- | :----------------------------------------------------------------- |
| `session_channel_not_found`         | No open channel exists for the given `channelId`                   |
| `session_channel_finalized`         | Channel has been closed and finalized                              |
| `session_amount_not_increasing`     | Voucher `cumulativeAmount` is not greater than the last known value |
| `session_amount_exceeds_deposit`    | Voucher `cumulativeAmount` exceeds the channel's deposit           |
| `session_invalid_increment`         | Delta does not equal the required `amount` per request             |
| `session_invalid_voucher_signature` | Voucher signature does not recover to an authorized signer         |
| `session_payee_mismatch`            | Channel payee does not match `payTo` in requirements               |
| `session_token_mismatch`            | Channel token does not match `asset` in requirements               |
| `session_settler_mismatch`          | Channel `authorizedSettler` does not match the facilitator's signer |
| `session_channel_expired`           | Channel close grace period has elapsed                             |
| `session_deposit_insufficient`      | Channel deposit is too low to cover another request                |

---

## Network-Specific Implementation

Network-specific rules and implementation details are defined in the per-network scheme documents:

- EVM chains: See [`scheme_session_evm.md`](./scheme_session_evm.md)
