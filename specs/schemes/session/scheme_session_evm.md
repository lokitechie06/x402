# Scheme: `session` on `EVM`

## Summary

The `session` scheme on EVM uses a modified **TempoStreamChannel** contract for onchain escrow, settlement and channel lifecycle management
that allows the facilitator to sponsor gas for both client and server operations.

| AssetTransferMethod | Use Case                                                    | Recommendation              |
| :------------------ | :---------------------------------------------------------- | :-------------------------- |
| **`eip3009`**       | Tokens with `receiveWithAuthorization` (e.g., USDC)         | **Recommended** (simplest, truly gasless)     |
| **`permit2`**       | Tokens without EIP-3009                                     | **Universal Fallback** (Works for any ERC-20) |

Default: `eip3009` if `extra.assetTransferMethod` is omitted.

---

## Session Channel Contract

The session channel contract is a unidirectional payment channel where the client (payer) deposits funds and the server (payee) can settle or close at any time using signed cumulative vouchers.

### Contract Interface Summary

| Function              | Caller                     | Description                                                              |
| :-------------------- | :------------------------- | :----------------------------------------------------------------------- |
| `open`                | Payer                      | Deposit tokens and create a channel (payer pays gas)                     |
| `openWithERC3009`     | Anyone (facilitator)       | Gasless channel open via ERC-3009 signature                              |
| `settle`              | Payee or authorizedSettler | Claim funds using a signed cumulative voucher                            |
| `topUp`               | Payer                      | Add funds to an existing channel (payer pays gas)                        |
| `topUpWithERC3009`    | Anyone (facilitator)       | Gasless top-up via ERC-3009 signature                                    |
| `requestClose`        | Payer                      | Begin the grace period for unilateral channel closure                    |
| `close`               | Payee or authorizedSettler | Cooperatively close, settling final voucher and refunding remainder      |
| `withdraw`            | Payer                      | Withdraw remaining funds after the close grace period                    |

In the x402 session flow, the **facilitator** is the sole gas-paying entity:

- **Client** signs ERC-3009 authorizations (off-chain) → facilitator submits `openWithERC3009` / `topUpWithERC3009`
- **Server** forwards vouchers to the facilitator → facilitator submits `settle` / `close` as the `authorizedSettler`

> **Requirement**: This contract MUST be deployed to the same address across all supported EVM chains using `CREATE2`.

See [`scheme_session_evm_contract.md`](./scheme_session_evm_contract.md) for the full contract specification.

### Voucher EIP-712 Type

Vouchers are signed using the EIP-712 typed data standard.

**Domain:**

```
name:    "Tempo Stream Channel"   (deployed contract constant)
version: "1"
```

**Type:**

```
Voucher(bytes32 channelId, uint128 cumulativeAmount)
```

The `channelId` is computed deterministically:

```
channelId = keccak256(abi.encode(payer, payee, token, salt, authorizedSigner, authorizedSettler, contractAddress, chainId))
```

### Contract Constants

| Constant             | Value      | Description                                              |
| :------------------- | :--------- | :------------------------------------------------------- |
| `CLOSE_GRACE_PERIOD` | 15 minutes | Time between a payer's close request and withdrawal eligibility |

---

## PaymentRequirements

| Field                       | Type      | Context              | Description                                                                 |
| :-------------------------- | :-------- | :------------------- | :-------------------------------------------------------------------------- |
| `extra.authorizedSettler`   | `string`  | Always               | Facilitator's signer address, used as `authorizedSettler` when opening channels |
| `extra.assetTransferMethod` | `string`  | Optional             | `"eip3009"` (default) or `"permit2"` (future). Omit to use default.         |
| `extra.channelId`           | `string`  | After channel open   | Existing channel for this client                                            |
| `extra.cumulativeAmount`    | `string`  | After channel open   | Server's last-known cumulative amount                                       |
| `extra.deposit`             | `string`  | After channel open   | Current channel deposit                                                     |

The `authorizedSettler` is the facilitator's onchain signer address. When opening a channel, the client MUST pass this address as the `authorizedSettler` parameter. This enables the facilitator to submit `settle` and `close` transactions on behalf of the server.

---

## 1. AssetTransferMethod: `EIP-3009`

For tokens that support `receiveWithAuthorization` (e.g., USDC), the session channel contract provides gasless channel operations.

### Channel Open: `openWithERC3009()`

The client signs an ERC-3009 `receiveWithAuthorization` for the deposit amount. The facilitator submits the `openWithERC3009()` transaction, paying gas:

```solidity
function openWithERC3009(
    address payer,              // client's address
    address payee,              // PaymentRequirements.payTo
    address token,              // PaymentRequirements.asset
    uint128 deposit,            // ≥ PaymentRequirements.amount
    bytes32 salt,               // client-generated random salt
    address authorizedSigner,   // 0x0 to use payer's own address, or a delegate
    address authorizedSettler,  // PaymentRequirements.extra.authorizedSettler (facilitator)
    uint256 validAfter,         // ERC-3009 authorization start time
    uint256 validBefore,        // ERC-3009 authorization expiry time
    bytes32 nonce,              // ERC-3009 authorization nonce
    bytes calldata signature    // ERC-3009 ReceiveWithAuthorization signature from payer
) external returns (bytes32 channelId)
```

**Authorized Signer**: Allows the client to delegate voucher signing to a different key (e.g., a hot wallet or session key). If set to `address(0)`, vouchers must be signed by the payer address.

**Authorized Settler**: MUST be set to the facilitator's signer address (from `PaymentRequirements.extra.authorizedSettler`). This enables the facilitator to call `settle` and `close` on behalf of the server.

### Top-Up: `topUpWithERC3009()`

Same pattern as channel open. The ERC-3009 token validates that the signature was produced by `channel.payer`, ensuring only the original payer can authorize additional deposits:

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

If a close request was pending, the top-up cancels it and the session continues uninterrupted.

### ERC-3009 Authorization Fields

The `channelOpen` and `topUp` payloads include an `erc3009Authorization` object:

| Field         | Type     | Description                                              |
| :------------ | :------- | :------------------------------------------------------- |
| `validAfter`  | `number` | Authorization start time (unix timestamp)                |
| `validBefore` | `number` | Authorization expiry time (unix timestamp)               |
| `nonce`       | `string` | Random nonce for replay protection                       |
| `signature`   | `string` | ERC-3009 `ReceiveWithAuthorization` signature from payer |

### PaymentPayload Examples

**Type: `channelOpen`**

```json
{
  "x402Version": 2,
  "accepted": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "1000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xFacilitatorSignerAddress"
    }
  },
  "payload": {
    "type": "channelOpen",
    "channelOpen": {
      "payer": "0xClientAddress",
      "payee": "0xServerPayeeAddress",
      "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "deposit": "100000",
      "salt": "0x...client-generated random salt",
      "authorizedSigner": "0x0000000000000000000000000000000000000000",
      "authorizedSettler": "0xFacilitatorSignerAddress",
      "erc3009Authorization": {
        "validAfter": 0,
        "validBefore": 1679616000,
        "nonce": "0x...random nonce",
        "signature": "0x...ERC-3009 ReceiveWithAuthorization signature from payer"
      }
    },
    "voucher": {
      "channelId": "0xabc123...computed channelId",
      "cumulativeAmount": "1000",
      "signature": "0x...EIP-712 voucher signature"
    }
  }
}
```

**Type: `voucher`**

The `accepted` block is echoed from the server's 402 response. It includes `extra.channelId` and `extra.cumulativeAmount`, which the facilitator uses for verification.

```json
{
  "x402Version": 2,
  "accepted": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "1000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xFacilitatorSignerAddress",
      "channelId": "0xabc123...channelId",
      "cumulativeAmount": "4000",
      "deposit": "100000"
    }
  },
  "payload": {
    "type": "voucher",
    "channelId": "0xabc123...channelId",
    "cumulativeAmount": "5000",
    "signature": "0x...65-byte EIP-712 signature",
    "requestClose": false
  }
}
```

**Type: `topUp`**

The `accepted` block is echoed from the server's 402 response. The client determined a top-up was needed because `cumulativeAmount + amount > deposit`.

```json
{
  "x402Version": 2,
  "accepted": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "1000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xFacilitatorSignerAddress",
      "channelId": "0xabc123...channelId",
      "cumulativeAmount": "100000",
      "deposit": "100000"
    }
  },
  "payload": {
    "type": "topUp",
    "topUp": {
      "channelId": "0xabc123...channelId",
      "additionalDeposit": "50000",
      "erc3009Authorization": {
        "validAfter": 0,
        "validBefore": 1679616000,
        "nonce": "0x...random nonce",
        "signature": "0x...ERC-3009 ReceiveWithAuthorization signature from payer"
      }
    },
    "voucher": {
      "channelId": "0xabc123...channelId",
      "cumulativeAmount": "101000",
      "signature": "0x...EIP-712 voucher signature"
    }
  }
}
```

### PaymentPayload Field Tables

**Type: `channelOpen`**

| Field                                         | Type     | Required | Description                                                                       |
| :-------------------------------------------- | :------- | :------- | :-------------------------------------------------------------------------------- |
| `payload.type`                                | `string` | Required | MUST be `"channelOpen"`                                                           |
| `payload.channelOpen.payer`                   | `string` | Required | Client's address                                                                  |
| `payload.channelOpen.payee`                   | `string` | Required | Server's payee address (MUST match `payTo`)                                       |
| `payload.channelOpen.token`                   | `string` | Required | Token contract address (MUST match `asset`)                                       |
| `payload.channelOpen.deposit`                 | `string` | Required | Amount to deposit (≥ `amount`)                                                    |
| `payload.channelOpen.salt`                    | `string` | Required | Client-generated random salt for `channelId` derivation                           |
| `payload.channelOpen.authorizedSigner`        | `string` | Required | Address authorized to sign vouchers (`0x0` = payer signs directly)                |
| `payload.channelOpen.authorizedSettler`       | `string` | Required | MUST match `extra.authorizedSettler` from requirements                            |
| `payload.channelOpen.erc3009Authorization`    | `object` | Required | ERC-3009 `receiveWithAuthorization` parameters                                    |
| `payload.voucher.channelId`                   | `string` | Required | Pre-computed `channelId` from `TempoStreamChannel.computeChannelId()`             |
| `payload.voucher.cumulativeAmount`            | `string` | Required | First voucher amount (= `amount` for one request)                                 |
| `payload.voucher.signature`                   | `string` | Required | EIP-712 signature over `Voucher(channelId, cumulativeAmount)`                     |

**Type: `voucher`**

| Field              | Type      | Required | Description                                                                                    |
| :----------------- | :-------- | :------- | :--------------------------------------------------------------------------------------------- |
| `type`             | `string`  | Required | MUST be `"voucher"`                                                                            |
| `channelId`        | `string`  | Required | `bytes32` channel identifier from `TempoStreamChannel.computeChannelId()`                      |
| `cumulativeAmount` | `string`  | Required | Total amount authorized across all requests in this session (monotonically increasing `uint128`) |
| `signature`        | `string`  | Required | EIP-712 signature over `Voucher(channelId, cumulativeAmount)` from payer or `authorizedSigner` |
| `requestClose`     | `boolean` | Optional | When `true`, the client requests channel closure. Defaults to `false`.                         |

**Type: `topUp`**

| Field                                      | Type     | Required | Description                                                        |
| :----------------------------------------- | :------- | :------- | :----------------------------------------------------------------- |
| `payload.type`                             | `string` | Required | MUST be `"topUp"`                                                  |
| `payload.topUp.channelId`                  | `string` | Required | Channel to top up                                                  |
| `payload.topUp.additionalDeposit`          | `string` | Required | Amount to add (MUST match ERC-3009 authorization value)            |
| `payload.topUp.erc3009Authorization`       | `object` | Required | ERC-3009 `receiveWithAuthorization` parameters                     |
| `payload.voucher.channelId`                | `string` | Required | Same `channelId` as the top-up                                     |
| `payload.voucher.cumulativeAmount`         | `string` | Required | Cumulative amount including this request (may exceed old deposit)  |
| `payload.voucher.signature`                | `string` | Required | EIP-712 voucher signature                                         |

---

## Facilitator Interface

The session scheme uses the standard x402 facilitator interface (`/verify`, `/settle`, `/supported`). The facilitator is stateless and derives session context from `accepted.extra` (echoed by the client from the 402 response) and onchain channel state. 

### POST /verify

Verifies a payment payload without onchain interaction. Accepts all payload types.

**Request (voucher — representative example):**

```json
{
  "x402Version": 2,
  "paymentPayload": {
    "x402Version": 2,
    "accepted": {
      "scheme": "session",
      "network": "eip155:8453",
      "amount": "1000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xServerPayeeAddress",
      "maxTimeoutSeconds": 3600,
      "extra": {
        "authorizedSettler": "0xFacilitatorSignerAddress",
        "channelId": "0xabc123...",
        "cumulativeAmount": "4000",
        "deposit": "100000"
      }
    },
    "payload": {
      "type": "voucher",
      "channelId": "0xabc123...",
      "cumulativeAmount": "5000",
      "signature": "0x..."
    }
  },
  "paymentRequirements": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "1000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xFacilitatorSignerAddress"
    }
  }
}
```

**Verification Logic:**

1. **Signature recovery**: Compute the EIP-712 digest for `Voucher(channelId, cumulativeAmount)` using the `TempoStreamChannel` domain separator. Recover the signer via `ecrecover`. This is a pure CPU operation.

2. **Signer authorization**: Read the channel via `TempoStreamChannel.getChannel(channelId)`. Verify the recovered signer matches `channel.payer` or `channel.authorizedSigner` (if non-zero). For `channelOpen` payloads where the channel doesn't exist yet, verify against the `channelOpen` parameters.

3. **Channel validity**: For `voucher` and `topUp` payloads, verify the channel exists (`channel.payer != address(0)`), is not finalized (`channel.finalized == false`), and `channel.payee` matches `paymentRequirements.payTo`. For `channelOpen`, validate the ERC-3009 authorization parameters.

4. **Settler authorization**: Verify `channel.authorizedSettler` (or `channelOpen.authorizedSettler` for opens) matches the facilitator's own signer address.

5. **Balance check** (`channelOpen` and `topUp` only): For `channelOpen` and `topUp` payloads, verify the client has sufficient token balance (`≥ deposit` for opens, `≥ additionalDeposit` for top-ups). These flows follow the same pattern as a regular `exact` scheme payment — funds are not yet in escrow at verification time and are deposited only after settlement. For `voucher` payloads this check is not needed as funds are already held in the channel contract.

6. **Amount validation** (using `accepted.extra`): The facilitator reads `lastCumulativeAmount` from `paymentPayload.accepted.extra.cumulativeAmount` and `deposit` from onchain `channel.deposit`. See verification rules in [`scheme_session.md`](./scheme_session.md).

7. **Token and network match**: `channel.token` MUST equal `paymentRequirements.asset`. The contract MUST be on the correct chain.

**Response:**

```json
{
  "isValid": true,
  "payer": "0xPayerAddress"
}
```

### POST /settle

Performs onchain operations. The facilitator infers the action from the payload:

| `settleAction` | Payload Type   | Onchain Operation                  | When Used                                       |
| :------------- | :------------- | :--------------------------------- | :---------------------------------------------- |
| `"open"`       | `channelOpen`  | `openWithERC3009()`                | First request — server opens the channel        |
| `"topUp"`      | `topUp`        | `topUpWithERC3009()`               | Client sent a top-up payload                    |
| `"settle"`     | `voucher`      | `settle(channelId, amount, sig)`   | Server batches settlement at its discretion     |
| `"close"`      | `voucher`      | `close(channelId, amount, sig)`    | Client requested close or server-initiated close |

**Request:**

```json
{
  "x402Version": 2,
  "paymentPayload": { "..." : "..." },
  "paymentRequirements": { "..." : "..." }
}
```

**Settlement Logic:**

- **`channelOpen`**: Submit `openWithERC3009()` using `payload.channelOpen` parameters. Returns the `channelId` and transaction hash.
- **`topUp`**: Submit `topUpWithERC3009()` using `payload.topUp` parameters. Returns the transaction hash.
- **`voucher`**: Submit `settle(channelId, cumulativeAmount, signature)` using the highest voucher. The contract transfers the delta between the onchain `settled` amount and `cumulativeAmount` to the payee.
- **`voucher` + `requestClose: true`**: Submit `close(channelId, cumulativeAmount, signature)` using the highest voucher. The contract settles the final amount and refunds the remainder to the payer.

**Response:**

```json
{
  "success": true,
  "transaction": "0x...transactionHash",
  "network": "eip155:8453",
  "payer": "0xPayerAddress",
  "extra": {
    "channelId": "0xabc123...",
    "cumulativeAmount": "5000",
    "deposit": "100000"
  }
}
```

The `extra` field contains updated session state. The server uses this to populate the `PAYMENT-RESPONSE` header. For `channelOpen` payloads, `extra.channelId` contains the newly created channel ID.

### GET /supported

```json
{
  "kinds": [
    { "x402Version": 2, "scheme": "session", "network": "eip155:8453" },
    { "x402Version": 2, "scheme": "exact", "network": "eip155:8453" }
  ],
  "extensions": [],
  "signers": {
    "eip155:*": ["0xFacilitatorSignerAddress"]
  }
}
```

---

## Channel Lifecycle Notes

**Reusing Existing Channels**: If a client has an open, non-finalized channel to the same `(payee, token)` with sufficient remaining balance (`deposit - settled ≥ amount`), it SHOULD reuse it rather than opening a new one. Servers MUST support receiving vouchers for any open channel where they are the payee.

**Cooperative Close**: The client includes `requestClose: true` in a voucher payload. The server processes the request normally, then calls `/settle`. The facilitator sees `requestClose: true` in the payload and calls `TempoStreamChannel.close()` as the `authorizedSettler`. The contract settles the final amount to the payee and refunds the remainder to the payer.

**Unilateral Close**: The client calls `TempoStreamChannel.requestClose()` directly onchain, starting the 15-minute grace period (`CLOSE_GRACE_PERIOD`). The server can still settle outstanding vouchers via the facilitator during this period. After the grace period, the client calls `withdraw()` to reclaim all unsettled funds.

---

## Version History

| Version | Date       | Changes                                                     | Author    |
| :------ | :--------- | :---------------------------------------------------------- | :-------- |
| v0.1    | 2025-03-21 | Initial draft                                               | @phdargen |
