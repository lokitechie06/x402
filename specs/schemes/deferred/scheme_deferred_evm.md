# Scheme: `deferred` on `EVM`

## Summary

The `deferred` scheme on EVM is a **capital-backed** network binding that uses a modified **TempoStreamChannel** contract for onchain escrow, settlement and channel lifecycle management. The client's commitment is backed by onchain capital deposited into the channel contract. Per-request payments are signed as off-chain cumulative vouchers; the server accumulates these and settles onchain at its discretion (batched or on close).


| AssetTransferMethod | Use Case                                                        | Recommendation                                           |
| ------------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| **`eip3009`**       | Tokens with `receiveWithAuthorization` (e.g., USDC)             | **Recommended** (simplest, truly gasless)                |
| **`permit2`**       | Tokens without EIP-3009, payer already has Permit2 approval     | **Universal Fallback** (works for any ERC-20)            |
| **`eip2612`**       | Tokens with EIP-2612 permit, no prior Permit2 approval by payer | **Gasless Onboarding** (EIP-2612 + Permit2, two sigs)   |


Default: `eip3009` if `extra.assetTransferMethod` is omitted.

---

## EVM Core Properties (MUST)

The `deferred` scheme on EVM MUST enforce the following invariants:

1. **Cumulative Monotonic Vouchers**: Each voucher carries a `cumulativeAmount` strictly greater than the previous, with the delta equal to the per-request price. Only the highest voucher matters for settlement. This eliminates double-spend risk without per-voucher nonce tracking.
2. **Capital-Backed Escrow**: Clients deposit funds into an onchain channel before consuming resources. The deposit is refundable (unsettled remainder returns on close) and can be topped up. This guarantees the server can always settle up to the deposit amount without further client cooperation.
3. **Server-Authorized Close**: Channel closure MUST require a signature from the payee or `authorizedSettler`. This prevents unauthorized parties from closing a channel and refunding the deposit before the server has settled earned funds. Settlement has no caller restriction as funds can only flow to the payee.
4. **Voucher Replay Protection**: Each voucher carries a monotonically increasing `nonce`. Subsequent settlements require a strictly higher `nonce`, preventing replay of previously settled vouchers regardless of their `cumulativeAmount`.

---

## Payment Channel Contract

The payment channel contract is a unidirectional payment channel where the client (payer) deposits funds and the server (payee) can settle or close at any time using signed cumulative vouchers.

### Contract Interface Summary


| Function            | Caller                               | Description                                                                            |
| ------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| `openWithERC3009`   | Anyone (facilitator)                 | Gasless channel open via ERC-3009 `receiveWithAuthorization` signature                 |
| `openWithPermit`    | Anyone (facilitator)                 | Gasless channel open via Permit2 `PermitTransferFrom` signature                        |
| `openWithEIP2612`   | Anyone (facilitator)                 | Gasless channel open via EIP-2612 permit + Permit2 (two signatures)                    |
| `settle`            | Anyone (valid voucher required)      | Batch-settle funds using signed cumulative vouchers (`VoucherSettlement[]`)             |
| `topUpWithERC3009`  | Anyone (facilitator)                 | Gasless top-up via ERC-3009 signature                                                  |
| `topUpWithPermit`   | Anyone (facilitator)                 | Gasless top-up via Permit2 signature                                                   |
| `topUpWithEIP2612`  | Anyone (facilitator)                 | Gasless top-up via EIP-2612 permit + Permit2 (two signatures)                          |
| `requestClose`      | Payer                                | Begin the grace period for unilateral channel closure                                  |
| `close`             | Anyone (requires CloseAuthorization) | Close channel with server-signed authorization, settle final voucher, refund remainder |
| `withdraw`          | Payer                                | Withdraw remaining funds after the close grace period                                  |


In the x402 deferred flow on EVM, the **facilitator** is the sole gas-paying entity:

- **Client** signs token transfer authorizations (off-chain) → facilitator submits `openWith*` / `topUpWith*` depending on the asset transfer method (`eip3009`, `permit2`, or `eip2612`)
- **Server** forwards vouchers + `CloseAuthorization` signatures to the facilitator → facilitator submits `settle` (no caller restriction) / `close` (with server's `CloseAuthorization`)

> **Requirement**: This contract MUST be deployed to the same address across all supported EVM chains using `CREATE2`.

See `[scheme_deferred_evm_contract.md](./scheme_deferred_evm_contract.md)` for the full contract specification.

### Voucher EIP-712 Type

Vouchers are signed using the EIP-712 typed data standard.

**Domain:**

```
name:    "Tempo Stream Channel"   (deployed contract constant)
version: "1"
```

**Type:**

```
Voucher(bytes32 channelId, uint8 voucherId, uint128 cumulativeAmount, uint64 nonce)
```

### CloseAuthorization EIP-712 Type

Close authorizations use the same EIP-712 domain as vouchers.

**Type:**

```
CloseAuthorization(bytes32 channelId, uint128 totalSettleAmount)
```

### Channel ID

The `channelId` is computed deterministically:

```
channelId = keccak256(abi.encode(payer, payee, token, salt, authorizedSigner, authorizedSettler, contractAddress, chainId))
```

### Contract Constants


| Constant             | Value      | Description                                                     |
| -------------------- | ---------- | --------------------------------------------------------------- |
| `CLOSE_GRACE_PERIOD` | 60 minutes | Time between a payer's close request and withdrawal eligibility |


---

## 402 Response (PaymentRequirements)

### Generic 402 (Default)

By default, the 402 contains only the pricing terms and the server's `authorizedSettler` address (close authorization signing key). `PaymentRequirements.amount` represents the **maximum** per-request price. 

```json
{
  "scheme": "deferred",
  "network": "eip155:8453",
  "amount": "100000",
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "payTo": "0xServerPayeeAddress",
  "maxTimeoutSeconds": 3600,
  "extra": {
    "authorizedSettler": "0xServerSettlerAddress",
    "name": "USDC",
    "version": "2",
    "maxVoucherId": 7
  }
}
```

### Enriched 402 (Client Identified or Corrective)

When the server can identify the client (e.g. via [sign-in-with-x](../../extensions/sign-in-with-x.md)), it includes the client's channel state in `extra`. This lets the client skip channel discovery.

```json
{
  "scheme": "deferred",
  "network": "eip155:8453",
  "amount": "100000",
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "payTo": "0xServerPayeeAddress",
  "maxTimeoutSeconds": 3600,
  "extra": {
    "authorizedSettler": "0xServerSettlerAddress",
    "name": "USDC",
    "version": "2",
    "maxVoucherId": 7,
    "channelId": "0xabc123...",
    "deposit": "1000000",
    "totalCharged": "5000",
    "vouchers": [
      {
        "voucherId": 0,
        "chargedCumulativeAmount": "3000",
        "signedCumulativeAmount": "3000",
        "nonce": 3,
        "signature": "0x..."
      },
      {
        "voucherId": 1,
        "chargedCumulativeAmount": "2000",
        "signedCumulativeAmount": "2000",
        "nonce": 2,
        "signature": "0x..."
      }
    ]
  }
}
```

### `extra` Field Reference


| Field                           | Type     | Required | Description                                                                                                                                                             |
| ------------------------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extra.authorizedSettler`       | `string` | yes      | Server's close authorization signing address (delegate). If `address(0)`, payee signs close authorizations directly. Used as `authorizedSettler` when opening channels. |
| `extra.assetTransferMethod`     | `string` | optional | `"eip3009"` (default), `"permit2"`, or `"eip2612"`. Omit to use default.                                                                                                |
| `extra.name`                    | `string` | yes      | EIP-712 domain name of the token contract (e.g., `"USDC"`)                                                                                                              |
| `extra.version`                 | `string` | yes      | EIP-712 domain version of the token contract (e.g., `"2"`)                                                                                                              |
| `extra.maxVoucherId`            | `uint8`  | yes      | Maximum `voucherId` the server supports (e.g., `7` for up to 8 concurrent series)                                                                                       |
| `extra.channelId`               | `string` | enriched | Channel identifier                                                                                                                                                      |
| `extra.deposit`                 | `string` | enriched | Server's known deposit                                                                                                                                                  |
| `extra.totalCharged`            | `string` | enriched | Sum of `chargedCumulativeAmount` across all voucherIds                                                                                                                  |
| `extra.vouchers`                | `array`  | enriched | Per-voucherId state array (each entry: `voucherId`, `chargedCumulativeAmount`, `signedCumulativeAmount`, `nonce`, `signature`)                                           |


---

## Client: Payment Construction

After receiving a 402, the client constructs a `PaymentPayload` containing its signed commitment. The payload type depends on the channel state:

- `**channelOpen**`: No open channel exists; client signs a token authorization and first voucher
- `**voucher**`: Channel exists with sufficient balance; client signs a new cumulative voucher
- `**topUp**`: Channel exists but balance exhausted; client signs a token authorization and voucher

### Asset Transfer Methods

All channel opens and top-ups are indirect — the client signs off-chain authorization(s) and the facilitator submits the transaction. The method depends on `extra.assetTransferMethod`.

**Authorized Signer** (open only): Allows the client to delegate voucher signing to a different key (e.g., a session key or delegate). If set to `address(0)`, vouchers must be signed by the payer address.

**Authorized Settler** (open only): MUST be set to the server's close authorization delegate address (from `PaymentRequirements.extra.authorizedSettler`). This designates which key must sign `CloseAuthorization` messages to authorize channel closure. If `address(0)`, the payee signs close authorizations directly.

If a close request was pending, any top-up cancels it and the session continues uninterrupted.

#### EIP-3009: `openWithERC3009()` / `topUpWithERC3009()`

The client signs an ERC-3009 `receiveWithAuthorization`. The facilitator submits the transaction, paying gas.

```solidity
function openWithERC3009(
    address payer,              // client's address
    address payee,              // PaymentRequirements.payTo
    address token,              // PaymentRequirements.asset
    uint128 deposit,            // ≥ PaymentRequirements.amount
    bytes32 salt,               // deterministic salt (see Channel Discovery)
    address authorizedSigner,   // 0x0 to use payer's own address, or a delegate
    address authorizedSettler,  // PaymentRequirements.extra.authorizedSettler (server delegate)
    uint256 validAfter,         // ERC-3009 authorization start time
    uint256 validBefore,        // ERC-3009 authorization expiry time
    bytes32 nonce,              // ERC-3009 authorization nonce
    bytes calldata signature    // ERC-3009 ReceiveWithAuthorization signature from payer
) external returns (bytes32 channelId)
```

```solidity
function topUpWithERC3009(
    bytes32 channelId,          // channel to top up
    uint256 additionalDeposit,  // amount to add (must match ERC-3009 value)
    uint256 validAfter,         // ERC-3009 authorization start time
    uint256 validBefore,        // ERC-3009 authorization expiry time
    bytes32 nonce,              // ERC-3009 authorization nonce
    bytes calldata signature    // ERC-3009 ReceiveWithAuthorization signature from payer
) external
```

#### Permit2: `openWithPermit()` / `topUpWithPermit()`

The client signs a Permit2 `PermitTransferFrom`. Requires the payer to have an existing ERC-20 approval to the Permit2 contract. The facilitator submits the transaction, paying gas.

```solidity
function openWithPermit(
    address payer,              // client's address
    address payee,              // PaymentRequirements.payTo
    address token,              // PaymentRequirements.asset
    uint128 deposit,            // ≥ PaymentRequirements.amount
    bytes32 salt,               // deterministic salt (see Channel Discovery)
    address authorizedSigner,   // 0x0 to use payer's own address, or a delegate
    address authorizedSettler,  // PaymentRequirements.extra.authorizedSettler (server delegate)
    uint256 nonce,              // Permit2 nonce
    uint256 deadline,           // Permit2 signature deadline
    bytes calldata signature    // Permit2 PermitTransferFrom signature from payer
) external returns (bytes32 channelId)
```

```solidity
function topUpWithPermit(
    bytes32 channelId,          // channel to top up
    uint256 additionalDeposit,  // amount to add (must match Permit2 value)
    uint256 nonce,              // Permit2 nonce
    uint256 deadline,           // Permit2 signature deadline
    bytes calldata signature    // Permit2 PermitTransferFrom signature from payer
) external
```

#### EIP-2612 + Permit2: `openWithEIP2612()` / `topUpWithEIP2612()`

For tokens that support EIP-2612 `permit` but where the payer has no prior Permit2 approval. The client signs **two** messages: an EIP-2612 permit (granting the Permit2 contract an ERC-20 allowance on the token) and a Permit2 `PermitTransferFrom` (authorizing the channel contract to pull tokens via Permit2). The contract executes `token.permit()` first, then uses Permit2 to transfer. The facilitator submits the transaction, paying gas.

```solidity
function openWithEIP2612(
    address payer,              // client's address
    address payee,              // PaymentRequirements.payTo
    address token,              // PaymentRequirements.asset
    uint128 deposit,            // ≥ PaymentRequirements.amount
    bytes32 salt,               // deterministic salt (see Channel Discovery)
    address authorizedSigner,   // 0x0 to use payer's own address, or a delegate
    address authorizedSettler,  // PaymentRequirements.extra.authorizedSettler (server delegate)
    uint256 permitDeadline,     // EIP-2612 permit deadline
    uint8 v,                    // EIP-2612 permit signature v
    bytes32 r,                  // EIP-2612 permit signature r
    bytes32 s,                  // EIP-2612 permit signature s
    uint256 permit2Nonce,       // Permit2 nonce
    uint256 permit2Deadline,    // Permit2 signature deadline
    bytes calldata permit2Signature // Permit2 PermitTransferFrom signature from payer
) external returns (bytes32 channelId)
```

```solidity
function topUpWithEIP2612(
    bytes32 channelId,          // channel to top up
    uint256 additionalDeposit,  // amount to add
    uint256 permitDeadline,     // EIP-2612 permit deadline
    uint8 v,                    // EIP-2612 permit signature v
    bytes32 r,                  // EIP-2612 permit signature r
    bytes32 s,                  // EIP-2612 permit signature s
    uint256 permit2Nonce,       // Permit2 nonce
    uint256 permit2Deadline,    // Permit2 signature deadline
    bytes calldata permit2Signature // Permit2 PermitTransferFrom signature from payer
) external
```

### PaymentPayload Examples

**Type: `channelOpen`**

The `channelOpen.authorization` field contains the token transfer authorization, whose shape depends on the asset transfer method. Exactly one of `erc3009Authorization`, `permit2Authorization`, or `eip2612Authorization` MUST be present.

```json
{
  "x402Version": 2,
  "accepted": {
    "scheme": "deferred",
    "network": "eip155:8453",
    "amount": "1000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xServerSettlerAddress",
      "name": "USDC",
      "version": "2"
    }
  },
  "payload": {
    "type": "channelOpen",
    "channelOpen": {
      "payer": "0xClientAddress",
      "payee": "0xServerPayeeAddress",
      "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "deposit": "100000",
      "salt": "0x...keccak256(abi.encode('x402-deferred', uint256(0)))",
      "authorizedSigner": "0x0000000000000000000000000000000000000000",
      "authorizedSettler": "0xServerSettlerAddress",
      "authorization": "<erc3009Authorization | permit2Authorization | eip2612Authorization>"
    },
    "voucher": {
      "channelId": "0xabc123...computed channelId",
      "voucherId": 0,
      "cumulativeAmount": "1000",
      "nonce": 1,
      "signature": "0x...EIP-712 voucher signature"
    }
  }
}
```

**Authorization variants:**

```json
"erc3009Authorization": {
  "validAfter": 0,
  "validBefore": 1679616000,
  "nonce": "0x...random nonce",
  "signature": "0x...ERC-3009 ReceiveWithAuthorization signature"
}
```

```json
"permit2Authorization": {
  "nonce": 0,
  "deadline": 1679616000,
  "signature": "0x...Permit2 PermitTransferFrom signature"
}
```

```json
"eip2612Authorization": {
  "permit": {
    "deadline": 1679616000,
    "v": 27,
    "r": "0x...",
    "s": "0x..."
  },
  "permit2": {
    "nonce": 0,
    "deadline": 1679616000,
    "signature": "0x...Permit2 PermitTransferFrom signature"
  }
}
```

**Type: `voucher`**

```json
{
  "x402Version": 2,
  "accepted": {
    "scheme": "deferred",
    "network": "eip155:8453",
    "amount": "1000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xServerSettlerAddress",
      "name": "USDC",
      "version": "2"
    }
  },
  "payload": {
      "type": "voucher",
      "channelId": "0xabc123...channelId",
      "voucherId": 0,
      "cumulativeAmount": "5000",
      "nonce": 5,
      "signature": "0x...65-byte EIP-712 signature",
      "requestClose": false
  }
}
```

**Type: `topUp`**

The `topUp.authorization` field uses the same variant union as `channelOpen` (exactly one of `erc3009Authorization`, `permit2Authorization`, or `eip2612Authorization`).

```json
{
  "x402Version": 2,
  "accepted": {
    "scheme": "deferred",
    "network": "eip155:8453",
    "amount": "1000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xServerSettlerAddress",
      "name": "USDC",
      "version": "2"
    }
  },
  "payload": {
    "type": "topUp",
    "topUp": {
      "channelId": "0xabc123...channelId",
      "additionalDeposit": "50000",
      "authorization": "<erc3009Authorization | permit2Authorization | eip2612Authorization>"
    },
    "voucher": {
      "channelId": "0xabc123...channelId",
      "voucherId": 0,
      "cumulativeAmount": "101000",
      "nonce": 10,
      "signature": "0x...EIP-712 voucher signature"
    }
  }
}
```

---

## Server: State & Facilitator Forwarding

The server is the sole owner of per-channel state. The facilitator is stateless.

### Per-Channel State

The server MUST maintain per-channel state and per-`(channelId, voucherId)` state:

**Per `(channelId, voucherId)`:**

| State Field               | Type      | Description                                                                             |
| ------------------------- | --------- | --------------------------------------------------------------------------------------- |
| `chargedCumulativeAmount` | `uint128` | Actual accumulated cost for this voucher series                                         |
| `signedCumulativeAmount`  | `uint128` | `cumulativeAmount` from the latest client-signed voucher (>= `chargedCumulativeAmount`) |
| `lastNonce`               | `uint64`  | Nonce from the latest accepted voucher for this series                                  |
| `signature`               | `bytes`   | Client's voucher signature for `signedCumulativeAmount`                                 |

**Per channel:**

| State Field               | Type      | Description                                                                             |
| ------------------------- | --------- | --------------------------------------------------------------------------------------- |
| `channelId`               | `bytes32` | Channel identifier                                                                      |
| `payer`                   | `address` | Client address                                                                          |
| `totalCharged`            | `uint128` | Sum of all voucherId `chargedCumulativeAmount` values                                   |
| `totalReserved`           | `uint128` | Sum of in-flight reservations (for deposit sufficiency checks)                          |
| `deposit`                 | `uint128` | Current channel deposit (mirrored from facilitator `/verify` response)                  |
| `totalSettled`            | `uint128` | Sum of onchain settled across all voucherIds (mirrored from facilitator response)       |
| `closeRequestedAt`        | `uint64`  | Close request timestamp, 0 if none (mirrored from facilitator response)                 |
| `lastRequestTimestamp`    | `uint64`  | Timestamp of the last paid request on this channel                                      |


### Request Processing (MUST)

The server MUST serialize the execute-commit cycle **per `(channelId, voucherId)`**. Requests on different voucherIds MAY proceed in parallel.

The server MUST NOT update voucher state until the resource handler has succeeded. This ensures the client is never charged for a failed request.

The server MUST track available deposit capacity = `deposit - totalCharged - totalReserved` to prevent concurrent requests from collectively over-committing the deposit before any of them settles.

1. **Verify**: Check increment locally, call facilitator `/verify` (no lock needed)
2. **Try-lock** on `(channelId, voucherId)`. If busy, reject with `deferred_voucher_busy`.
3. **Reserve** (atomic): if `totalCharged + totalReserved + amount > deposit` → reject, release lock. Else `totalReserved += amount`.
4. **Execute**: Run the resource handler
5a. **On success** — commit voucherId state:
  - Determine `actualPrice` (the actual charge for this request, `<= PaymentRequirements.amount`)
  - `chargedCumulativeAmount += actualPrice` (per voucherId)
  - `totalCharged += actualPrice` (per channel)
  - `totalReserved -= amount` (release reservation)
  - `signedCumulativeAmount = payload.cumulativeAmount`
  - `lastNonce = payload.nonce`
  - `signature = payload.signature`
  - Mirror `deposit`, `totalSettled`, `closeRequestedAt` from the facilitator response
  - Update `lastRequestTimestamp`
5b. **On failure**: `totalReserved -= amount` (rollback reservation). State unchanged, client can retry same voucher.
6. **Release lock**

---

## Facilitator Interface

The `deferred` scheme on EVM uses the standard x402 facilitator interface (`/verify`, `/settle`, `/supported`). The facilitator is stateless and derives context from `payload` (client's signed commitment), `paymentRequirements` (base 402 terms) and onchain channel state.

### `/settle` Behavior on EVM

The EVM binding uses `/settle` for two distinct purposes:

1. **Channel lifecycle operations** (open, topUp, close): These execute onchain immediately and `SettlementResponse.transaction` contains a real tx hash.
2. **Per-request voucher flow**: For normal voucher requests, the server does NOT call `/settle`. It only calls `/verify` and stores the voucher locally. The server batches settlement at its discretion, calling `/settle` with accumulated vouchers when economically optimal.

### POST /verify

Verifies a payment payload without onchain interaction.

Verification logic is defined in [Verification Rules](#verification-rules-must).

**Response:**

```json
{
  "isValid": true,
  "payer": "0xPayerAddress",
  "extra": {
    "deposit": "1000000",
    "totalSettled": "500000",
    "closeRequestedAt": 0
  }
}
```

The server mirrors `deposit`, `totalSettled`, and `closeRequestedAt` into its per-channel state (see [Request Processing](#request-processing-must)).

### POST /settle

Performs onchain operations. The facilitator infers the action from the payload:


| `settleAction` | Payload Type  | Onchain Operation                                                     | When Used                                        |
| -------------- | ------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| `"open"`       | `channelOpen` | `openWith{ERC3009,Permit,EIP2612}()` (per authorization variant)      | First request — server opens the channel         |
| `"topUp"`      | `topUp`       | `topUpWith{ERC3009,Permit,EIP2612}()` (per authorization variant)     | Client sent a top-up payload                     |
| `"settle"`     | `voucher`     | `settle(channelId, VoucherSettlement[])`                              | Server batches settlement at its discretion      |
| `"close"`      | `voucher`     | `close(channelId, VoucherSettlement[], closeAuth)`                    | Client requested close or server-initiated close |


**Request (voucher settle example):**

```json
{
  "x402Version": 2,
  "paymentPayload": {
    "x402Version": 2,
    "accepted": {
      "scheme": "deferred",
      "network": "eip155:8453",
      "amount": "1000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xServerPayeeAddress",
      "maxTimeoutSeconds": 3600,
      "extra": {
        "authorizedSettler": "0xServerSettlerAddress",
        "name": "USDC",
        "version": "2"
      }
    },
    "payload": {
      "type": "voucher",
      "channelId": "0xabc123...",
      "voucherId": 0,
      "cumulativeAmount": "5000",
      "nonce": 5,
      "settleAmount": "3500",
      "signature": "0x...EIP-712 voucher signature",
      "requestClose": false
    }
  },
  "paymentRequirements": {
    "scheme": "deferred",
    "network": "eip155:8453",
    "amount": "1000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xServerSettlerAddress",
      "name": "USDC",
      "version": "2"
    }
  }
}
```

**Settlement Logic:**

- `**channelOpen`**: Submit the appropriate `openWith*()` variant based on `payload.channelOpen.authorization` (ERC-3009 → `openWithERC3009`, Permit2 → `openWithPermit`, EIP-2612 → `openWithEIP2612`). Returns the `channelId` and transaction hash.
- `**topUp`**: Submit the appropriate `topUpWith*()` variant based on `payload.topUp.authorization`. Returns the transaction hash.
- `**voucher`**: Submit `settle(channelId, VoucherSettlement[])` with one or more voucher entries. Each entry settles independently per `(channelId, voucherId)`. The contract verifies each voucher signature, accumulates the total delta, and updates `channel.totalSettled`.
- `**voucher` + `requestClose: true`**: Submit `close(channelId, VoucherSettlement[], closeAuthorization)` with the `CloseAuthorization` signature from the server. The `CloseAuthorization` is signed over the final `totalSettleAmount` (= `channel.totalSettled` after processing all vouchers). The contract settles, then refunds `deposit - totalSettleAmount` to the payer.

**Response:**

```json
{
  "success": true,
  "transaction": "0x...transactionHash",
  "network": "eip155:8453",
  "payer": "0xPayerAddress",
  "amount": "700",
  "extra": {
    "channelId": "0xabc123...",
    "voucherId": 0,
    "chargedCumulativeAmount": "3200",
    "nonce": 5,
    "deposit": "100000",
    "totalSettled": "0",
    "closeRequestedAt": 0
  }
}
```

The `amount` field contains the actual charge for the request (`<= PaymentRequirements.amount`). The `extra` field contains updated channel state. `extra.chargedCumulativeAmount` is the actual accumulated cost for the given `voucherId`. `extra.nonce` is the nonce from the latest accepted voucher. The server mirrors `deposit`, `totalSettled`, `closeRequestedAt`, and `nonce` into its state and uses them along with `amount` and `chargedCumulativeAmount` to populate the `PAYMENT-RESPONSE` header. For `channelOpen` payloads, `extra.channelId` contains the newly created channel ID.

### GET /supported

```json
{
  "kinds": [
    { "x402Version": 2, "scheme": "deferred", "network": "eip155:8453" },
    { "x402Version": 2, "scheme": "exact", "network": "eip155:8453" }
  ],
  "extensions": [],
  "signers": {
    "eip155:*": ["0xFacilitatorSignerAddress"]
  }
}
```

### Verification Rules (MUST)

A facilitator verifying a `deferred`-scheme payment on EVM MUST enforce:

1. **Signature validity**: Compute the EIP-712 digest for `Voucher(channelId, voucherId, cumulativeAmount, nonce)` using the `TempoStreamChannel` domain separator. Recover the signer via `ecrecover`. The recovered signer MUST match `channel.payer` or `channel.authorizedSigner` (if non-zero). For `channelOpen` payloads, verify against the `channelOpen` parameters.
2. **Channel existence**: For `voucher` and `topUp` payloads, read `TempoStreamChannel.getChannel(channelId)` -- the channel MUST exist (`payer != address(0)`) and not be finalized. For `channelOpen`, the channel MUST NOT already exist.
3. **Payee match**: `channel.payee` MUST equal `paymentRequirements.payTo`.
4. **Token match**: `channel.token` MUST equal `paymentRequirements.asset`. The contract MUST be on the correct chain.
5. **Balance check** (`channelOpen` and `topUp` only): Verify the client has sufficient token balance (`≥ deposit` for opens, `≥ additionalDeposit` for top-ups). For `voucher` payloads this is not needed as funds are already in escrow.
6. **Deposit sufficiency**: `payload.cumulativeAmount` MUST be ≤ `channel.deposit` (onchain). For `topUp` payloads, `payload.cumulativeAmount` MUST be ≤ `channel.deposit + topUp.additionalDeposit`.
7. **Not below settled** (per voucherId): `payload.cumulativeAmount` MUST be > `voucherStates[channelId][voucherId].settled` (onchain). Prevents replay of already-settled vouchers.
8. **Settle amount bounds** (settlement only, per voucherId): `settleAmount` MUST be `<= cumulativeAmount` and `settleAmount` MUST be `> voucherStates[channelId][voucherId].settled` (onchain).
9. **Voucher replay protection** (settlement only, per voucherId): `nonce` MUST be `> voucherStates[channelId][voucherId].nonce` (onchain). This prevents replay of a previously settled voucher.

The facilitator checks per-voucherId — it is stateless w.r.t. other voucherIds. The **server** enforces the aggregate constraint across all voucherIds (`totalCharged + totalReserved + amount <= deposit`).

The facilitator MUST return the onchain channel snapshot (`deposit`, `totalSettled`, `closeRequestedAt`) in the `/verify` and `/settle` response `extra` field. If `closeRequestedAt != 0`, the server should settle immediately to protect its funds before the grace period expires.

#### Server Check (off-chain)

The server MUST check the cumulative amount increment locally per `(channelId, voucherId)`:

- `payload.cumulativeAmount` MUST equal `chargedCumulativeAmount[voucherId] + paymentRequirements.amount`
- `payload.nonce` MUST equal `lastNonce[voucherId] + 1`
- `payload.voucherId` MUST be `<= maxVoucherId` (server rejects with `deferred_invalid_voucher_id` otherwise)

Note that the client bases its next voucher on the server-reported actual cumulative (from `PAYMENT-RESPONSE.extra.chargedCumulativeAmount`) and nonce (from `PAYMENT-RESPONSE.extra.nonce`) for the given `voucherId`.

If it fails, the server rejects with `deferred_stale_cumulative_amount` and returns a corrective 402.

For time-critical applications the server may skip the `/verify` facilitator call for `voucher` payloads and perform the verification itself based on cached onchain state that is polled periodically.

---

## Settlement Strategy

The resource server controls when and how often onchain settlement occurs:


| Strategy      | Description                            | Trade-off                        |
| ------------- | -------------------------------------- | -------------------------------- |
| **Periodic**  | Settle every N minutes                 | Predictable gas costs            |
| **Threshold** | Settle when unsettled amount exceeds T | Bounds server's risk exposure    |
| **On close**  | Settle only when closing the channel   | Minimum gas, maximum risk window |


---

## Channel Discovery

When a client has lost state and receives a generic 402 (no channel state), it must rediscover open channels via the contract. This requires **deterministic salt** so the client can compute channel IDs without server cooperation.

### Deterministic Salt Convention (MUST)

For a stateless client to rediscover channels via contract reads, the salt MUST be deterministic:

```
salt = keccak256(abi.encode("x402-deferred", uint256(sequenceIndex)))
```

Where `sequenceIndex` starts at 0 and increments for concurrent channels between the same `(payer, payee, token, authorizedSigner, authorizedSettler)` tuple.

### Discovery Algorithm

1. Client reads `payTo`, `asset`, `authorizedSettler` from the 402 response
2. Client computes `channelId` values for indices 0, 1, 2, ... using the deterministic salt formula
3. Client calls `getChannelsBatch([id0, id1, id2, ...])` -- single RPC call
4. For each result, classify:
  - `payer != address(0)` and `finalized == false` → **open channel** (usable)
  - `payer == address(0)` and `finalized == true` → **closed channel** (skip, continue scanning)
  - `payer == address(0)` and `finalized == false` → **never opened** (stop iterating)
5. From open channels, select one with sufficient remaining balance (`deposit - totalSettled >= amount`)
6. Use the lowest never-opened index when opening a new channel

### Resume After Discovery

After discovering an open channel, the client picks a `voucherId` (default `0`) and anchors its voucher to the onchain `voucherStates[channelId][voucherId].settled` amount (`cumulativeAmount = settled + amount`) and nonce (`nonce = voucherStates[channelId][voucherId].nonce + 1`). If the server has unsettled vouchers above settled for that `voucherId`, the server rejects with `session_stale_cumulative_amount` and returns a corrective 402 with per-voucherId state in `extra.vouchers`. The client verifies the signature and retries with the corrected cumulative amount and nonce. At most one extra roundtrip.

If the server supports the [sign-in-with-x](../../extensions/sign-in-with-x.md) extension and the client provides a `SIGN-IN-WITH-X` header, the server includes channel state in the 402 directly, skipping the contract read and potential stale-settled roundtrip. The client MUST verify `signature` before using server-provided state (see [Client Verification Rules](#client-verification-rules-must)).

---

## Client Verification Rules (MUST)

The facilitator's verification rules protect the server. The following rules protect the **client** from a misbehaving server. 

### In-Session Verification

Before using `PAYMENT-RESPONSE` values as the base for the next voucher, the client MUST check:

1. **Actual charge within bounds**: `PAYMENT-RESPONSE.amount` MUST be `<= PaymentRequirements.amount`. The server cannot charge more than the advertised maximum.
2. **Cumulative amount increment**: `PAYMENT-RESPONSE.extra.chargedCumulativeAmount` MUST equal `previousChargedCumulativeAmount + PAYMENT-RESPONSE.amount`. If the server inflates the cumulative, the client would sign vouchers authorizing more than the actual cost.
3. **Deposit consistency**: For non-topup responses, `PAYMENT-RESPONSE.extra.deposit` MUST equal the client's last known deposit. For topup responses, it MUST equal `previousDeposit + additionalDeposit`.
4. **Channel ID consistency**: `PAYMENT-RESPONSE.extra.channelId` MUST match the channel the client is operating on.

The client computes the next voucher for the same `voucherId` as: `nextCumulativeAmount = PAYMENT-RESPONSE.extra.chargedCumulativeAmount + PaymentRequirements.amount` and `nextNonce = PAYMENT-RESPONSE.extra.nonce + 1`.

If any check fails, the client MUST NOT sign further vouchers and SHOULD initiate channel closure.

### Recovery Verification

When the client has lost state and receives a corrective 402 (or SIWX-enriched 402) containing channel state, the server MUST include per-voucherId state in the `extra.vouchers` array. Each entry contains `voucherId`, `signature`, `chargedCumulativeAmount`, `signedCumulativeAmount`, and `nonce`.

For each `voucherId` the client intends to use:

1. **Voucher signature**: Compute the EIP-712 `Voucher(channelId, voucherId, signedCumulativeAmount, nonce)` digest, recover the signer from `signature`, confirm it matches the client's own address (or `authorizedSigner`).
2. **Charged within signed**: `chargedCumulativeAmount` MUST be `<= signedCumulativeAmount`. The server cannot claim more than the client authorized.
3. **Onchain consistency**: `chargedCumulativeAmount` MUST be ≥ the onchain `voucherStates[channelId][voucherId].settled`. `extra.deposit` MUST match the onchain deposit.
4. **Resume**: The client resumes with `chargedCumulativeAmount` as the base for the next voucher (`nextCumulativeAmount = chargedCumulativeAmount + PaymentRequirements.amount`) and `nextNonce = nonce + 1` for that `voucherId`.

If the signature does not verify, the client MUST NOT sign based on the server's claimed state and SHOULD fall back to unilateral channel closure.

---

## Channel Lifecycle Notes

**Reusing Existing Channels**: If a client has an open, non-finalized channel to the same `(payee, token)` with sufficient remaining balance (`deposit - totalSettled ≥ amount`), it SHOULD reuse it rather than opening a new one. Servers MUST support receiving vouchers for any open channel where they are the payee.

**Cooperative Close**: The client includes `requestClose: true` in a voucher payload. The server processes the request normally, constructs `VoucherSettlement[]` entries for all active voucherIds, computes `totalSettleAmount` (the final `channel.totalSettled`), then signs a `CloseAuthorization(channelId, totalSettleAmount)` with its payee key or `authorizedSettler` delegate and includes it in the `/settle` request to the facilitator. The facilitator sees `requestClose: true` in the payload and calls `TempoStreamChannel.close(channelId, VoucherSettlement[], closeAuthorization)`. The contract processes the voucher array, verifies the `CloseAuthorization` over the final `totalSettleAmount`, settles the earned amount to the payee, and refunds `deposit - totalSettleAmount` to the payer. If no identification extensions are in use and the client does not persist state, it SHOULD close the channel at the end of its session to avoid resume complexity.

**Unilateral Close (Escape Hatch)**: If the server becomes unresponsive and the client cannot initiate a cooperative close, the client calls `TempoStreamChannel.requestClose(channelId)` directly onchain, paying gas themselves. This starts the `CLOSE_GRACE_PERIOD`. The server can still settle outstanding vouchers via the facilitator during this period. After the grace period, the client calls `withdraw()` to reclaim all unsettled funds. 

**Server Settlement Timing**: The server SHOULD settle (or close) outstanding vouchers for a channel within `CLOSE_GRACE_PERIOD` of the last client request on that channel. This ensures the server captures earned funds even if the client initiates a unilateral close after the session goes idle. The facilitator provides an additional safety net: since it reads `channel.closeRequestedAt` from onchain state during `/verify` and `/settle` (see [Verification Rules](#verification-rules-must) rule 8), the server is alerted if a close request is already in progress and can settle immediately. Together, time-based settlement and facilitator detection protect the server without requiring onchain event monitoring. Servers managing many concurrent channels MAY additionally monitor onchain `CloseRequested` events (e.g. via RPC polling or an indexer) for more proactive awareness.

**Channel Rotation Requirement**: Servers MUST close all active channels before changing either `payTo` or `authorizedSettler`. Both values are part of the `channelId` computation. Changing them while channels are open would leave clients with channels pointing to stale server keys. After closing all channels, the server updates its 402 response with the new values and clients open fresh channels on the next request.

---

## Error Codes

Implementers MUST use the generic `deferred` error codes from `[scheme_deferred.md](./scheme_deferred.md#error-codes)` when the failure matches the generic semantics. 

The EVM network binding additionally defines these binding-specific codes:


| Error Code                        | Description                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deferred_evm_invalid_increment`  | Delta does not equal the required `amount` per request                                                                                                                  |
| `deferred_evm_payee_mismatch`     | Channel payee does not match `payTo` in requirements                                                                                                                    |
| `deferred_evm_token_mismatch`     | Channel token does not match `asset` in requirements                                                                                                                    |
| `session_stale_cumulative_amount` | After channel discovery, client voucher base used onchain per-voucherId `settled`/`nonce` but server holds higher state ([Resume After Discovery](#resume-after-discovery)). |
| `deferred_voucher_busy`           | Another request on this `(channelId, voucherId)` is currently executing.                                                                                                |
| `deferred_invalid_voucher_id`     | `voucherId` exceeds the server's `maxVoucherId`.                                                                                                                        |


---

## Version History


| Version | Date       | Changes                          | Author    |
| ------- | ---------- | -------------------------------- | --------- |
| v0.3    | 2026-03-31 | Add voucherId for concurrency    | @phdargen |
| v0.2    | 2025-03-30 | Add dynamic price                | @phdargen |
| v0.1    | 2025-03-21 | Initial draft                    | @phdargen |