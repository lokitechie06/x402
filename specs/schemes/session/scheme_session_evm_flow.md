# Session Scheme: EVM Full Lifecycle Example

API charges **$0.10 per lookup** in USDC. The client opens a channel with a $1.00 deposit (enough for 10 requests), uses it, tops up when the deposit runs out and eventually closes.

## Actors & Constants

| Role                 | Value                                          |
| :------------------- | :--------------------------------------------- |
| Client (payer)       | `0xClientAddress`                              |
| Server (payee)       | `0xServerPayeeAddress`                         |
| Facilitator signer   | `0xFacilitatorSignerAddress`                   |
| USDC on Base         | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`  |
| Network              | `eip155:8453` (Base)                           |
| Price per request    | `100000` ($0.10 USDC, 6 decimals)              |

## Lifecycle Summary

| Step | Action        | Cumulative | Deposit   | Onchain              | Client Spend | Client Refund |
| :--- | :------------ | :--------- | :-------- | :------------------- | :----------- | :------------ |
| 1    | Initial 402   | —          | —         | —                    | —            | —             |
| 2    | Channel Open  | $0.10      | $1.00     | `openWithERC3009`    | $1.00        | —             |
| 3    | Voucher       | $0.20      | $1.00     | —                    | —            | —             |
| …    | Requests 3–10 | $1.00      | $1.00     | —                    | —            | —             |
| 4    | Top-Up        | $1.10      | $1.50     | `topUpWithERC3009`   | $0.50        | —             |
| 5    | Close         | $1.20      | $1.50     | `close`              | —            | $0.30         |

---

## Step 1: Initial 402 — Client Hits the API for the First Time

The client requests the API. The server has no channel for this client and returns 402. No `channelId` in `extra` signals that a new channel must be opened.

**Client request:**

```http
GET /geocode?q=Times+Square HTTP/1.1
Host: api.example.com
```

**Server response — 402 with `PAYMENT-REQUIRED` header (base64-decoded):**

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "https://api.example.com/",
    "description": "API",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "session",
      "network": "eip155:8453",
      "amount": "100000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xServerPayeeAddress",
      "maxTimeoutSeconds": 3600,
      "extra": {
        "authorizedSettler": "0xFacilitatorSignerAddress"
      }
    }
  ]
}
```

> No `channelId` in `extra` → client must open a new channel.

---

## Step 2: Channel Open — Client Deposits $1.00, Signs First Voucher for $0.10

The client decides to deposit $1.00 (`1000000`) to cover ~10 requests. It signs two things off-chain:

1. An **ERC-3009 `receiveWithAuthorization`** transferring $1.00 USDC to the channel contract
2. An **EIP-712 voucher** for $0.10 cumulative (`100000`) — payment for this first request

### `PAYMENT-SIGNATURE` header (base64-decoded)

```json
{
  "x402Version": 2,
  "accepted": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "100000",
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
      "deposit": "1000000",
      "salt": "0xa1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      "authorizedSigner": "0x0000000000000000000000000000000000000000",
      "authorizedSettler": "0xFacilitatorSignerAddress",
      "erc3009Authorization": {
        "validAfter": 0,
        "validBefore": 1711929600,
        "nonce": "0xe4f8b1c2d3a4e5f6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
        "signature": "0x...ERC-3009 ReceiveWithAuthorization signature from client"
      }
    },
    "voucher": {
      "channelId": "0xabc123...channelId",
      "cumulativeAmount": "100000",
      "signature": "0x...EIP-712 Voucher signature from client"
    }
  }
}
```

### Server → Facilitator: `POST /verify` — validate deposit authorization + voucher

The server forwards the payload to the facilitator for validation. The facilitator verifies the ERC-3009 authorization parameters, checks that the client has sufficient token balance for the deposit, recovers the EIP-712 signer from the voucher, confirms it matches the `channelOpen` payer (or `authorizedSigner`), and validates the amount. No onchain transaction occurs at this stage — funds are not yet in escrow.

**Request:**

```json
{
  "x402Version": 2,
  "paymentPayload": {
    "x402Version": 2,
    "accepted": {
      "scheme": "session",
      "network": "eip155:8453",
      "amount": "100000",
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
        "deposit": "1000000",
        "salt": "0xa1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        "authorizedSigner": "0x0000000000000000000000000000000000000000",
        "authorizedSettler": "0xFacilitatorSignerAddress",
        "erc3009Authorization": {
          "validAfter": 0,
          "validBefore": 1711929600,
          "nonce": "0xe4f8b1c2d3a4e5f6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
          "signature": "0x...ERC-3009 ReceiveWithAuthorization signature from client"
        }
      },
      "voucher": {
        "channelId": "0xabc123...channelId",
        "cumulativeAmount": "100000",
        "signature": "0x...EIP-712 Voucher signature from client"
      }
    }
  },
  "paymentRequirements": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "100000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xFacilitatorSignerAddress"
    }
  }
}
```

**Response:**

```json
{
  "isValid": true,
  "payer": "0xClientAddress"
}
```

### Server → Facilitator: `POST /settle` — open the channel onchain

After verification succeeds, the server calls `/settle`. The facilitator sees `payload.type: "channelOpen"` and calls `openWithERC3009()` on the channel contract, paying gas. This executes the ERC-3009 deposit and creates the channel onchain.

**Request:**

```json
{
  "x402Version": 2,
  "paymentPayload": "« same paymentPayload as /verify request above »",
  "paymentRequirements": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "100000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xFacilitatorSignerAddress"
    }
  }
}
```

**Response:**

```json
{
  "success": true,
  "transaction": "0x...openWithERC3009 txHash",
  "network": "eip155:8453",
  "payer": "0xClientAddress",
  "extra": {
    "channelId": "0xabc123...channelId",
    "cumulativeAmount": "100000",
    "deposit": "1000000"
  }
}
```

### `PAYMENT-RESPONSE` header (base64-decoded)

The server returns 200 with the resource and a `PAYMENT-RESPONSE` header containing the new channel state. The client stores `channelId`, `cumulativeAmount`, and `deposit` for future requests.

```json
{
  "success": true,
  "transaction": "0x...openWithERC3009 txHash",
  "network": "eip155:8453",
  "payer": "0xClientAddress",
  "extra": {
    "channelId": "0xabc123...channelId",
    "cumulativeAmount": "100000",
    "deposit": "1000000"
  }
}
```

> Channel state: deposit = $1.00, spent = $0.10, remaining = $0.90

---

## Step 3: Second Request — Client Signs Voucher for $0.20 Cumulative (No Onchain Transaction)

The client makes another lookup. The server returns a 402 with the channel state. The client signs a new cumulative voucher incrementing by $0.10. The facilitator verifies the signature off-chain — no onchain transaction needed.

### `PAYMENT-REQUIRED` header (base64-decoded)

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "accepts": [
    {
      "scheme": "session",
      "network": "eip155:8453",
      "amount": "100000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xServerPayeeAddress",
      "maxTimeoutSeconds": 3600,
      "extra": {
        "authorizedSettler": "0xFacilitatorSignerAddress",
        "channelId": "0xabc123...channelId",
        "cumulativeAmount": "100000",
        "deposit": "1000000"
      }
    }
  ]
}
```

> `channelId` present → reuse existing channel.
> Client computes: 100000 + 100000 = 200000 ≤ 1000000 (deposit) → no top-up needed.

### `PAYMENT-SIGNATURE` header (base64-decoded)

```json
{
  "x402Version": 2,
  "accepted": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "100000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xFacilitatorSignerAddress",
      "channelId": "0xabc123...channelId",
      "cumulativeAmount": "100000",
      "deposit": "1000000"
    }
  },
  "payload": {
    "type": "voucher",
    "channelId": "0xabc123...channelId",
    "cumulativeAmount": "200000",
    "signature": "0x...EIP-712 Voucher signature (cumulative $0.20)"
  }
}
```

### Server → Facilitator: `POST /verify` — signature check only

**Request:**

```json
{
  "x402Version": 2,
  "paymentPayload": {
    "x402Version": 2,
    "accepted": {
      "scheme": "session",
      "network": "eip155:8453",
      "amount": "100000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xServerPayeeAddress",
      "maxTimeoutSeconds": 3600,
      "extra": {
        "authorizedSettler": "0xFacilitatorSignerAddress",
        "channelId": "0xabc123...channelId",
        "cumulativeAmount": "100000",
        "deposit": "1000000"
      }
    },
    "payload": {
      "type": "voucher",
      "channelId": "0xabc123...channelId",
      "cumulativeAmount": "200000",
      "signature": "0x...EIP-712 Voucher signature (cumulative $0.20)"
    }
  },
  "paymentRequirements": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "100000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xFacilitatorSignerAddress"
    }
  }
}
```

**Response:**

```json
{
  "isValid": true,
  "payer": "0xClientAddress"
}
```

> No `/settle` call — the server defers onchain settlement and accumulates vouchers.

### `PAYMENT-RESPONSE` header (base64-decoded)

```json
{
  "success": true,
  "network": "eip155:8453",
  "payer": "0xClientAddress",
  "extra": {
    "channelId": "0xabc123...channelId",
    "cumulativeAmount": "200000",
    "deposit": "1000000"
  }
}
```

> Channel state: deposit = $1.00, spent = $0.20, remaining = $0.80
>
> Requests 3–10 follow the same voucher pattern. Each increments `cumulativeAmount` by 100000.
> After request 10: `cumulativeAmount` = 1000000 = `deposit`.

---

## Step 4: Top-Up — Deposit Exhausted After 10 Requests, Client Adds $0.50

On the 11th request, the server's 402 shows `cumulativeAmount` equals `deposit` ($1.00 each). The client detects that the next voucher ($1.10) would exceed the deposit and signs both an ERC-3009 authorization for a $0.50 top-up and a new voucher.

### `PAYMENT-REQUIRED` header (base64-decoded)

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "accepts": [
    {
      "scheme": "session",
      "network": "eip155:8453",
      "amount": "100000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xServerPayeeAddress",
      "maxTimeoutSeconds": 3600,
      "extra": {
        "authorizedSettler": "0xFacilitatorSignerAddress",
        "channelId": "0xabc123...channelId",
        "cumulativeAmount": "1000000",
        "deposit": "1000000"
      }
    }
  ]
}
```

> Client computes: 1000000 + 100000 = 1100000 > 1000000 (deposit) → top-up required.
> Client decides to add $0.50 (500000), bringing deposit to $1.50 (1500000) for 5 more requests.

### `PAYMENT-SIGNATURE` header (base64-decoded)

```json
{
  "x402Version": 2,
  "accepted": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "100000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xFacilitatorSignerAddress",
      "channelId": "0xabc123...channelId",
      "cumulativeAmount": "1000000",
      "deposit": "1000000"
    }
  },
  "payload": {
    "type": "topUp",
    "topUp": {
      "channelId": "0xabc123...channelId",
      "additionalDeposit": "500000",
      "erc3009Authorization": {
        "validAfter": 0,
        "validBefore": 1711933200,
        "nonce": "0xb2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3",
        "signature": "0x...ERC-3009 ReceiveWithAuthorization signature for $0.50 top-up"
      }
    },
    "voucher": {
      "channelId": "0xabc123...channelId",
      "cumulativeAmount": "1100000",
      "signature": "0x...EIP-712 Voucher signature (cumulative $1.10)"
    }
  }
}
```

### Server → Facilitator: `POST /verify` — validate top-up authorization + voucher

The server forwards the payload to the facilitator for validation. The facilitator verifies the ERC-3009 authorization parameters for the additional deposit, checks that the client has sufficient token balance, validates the voucher signature against the channel's authorized signer, and confirms the new cumulative amount does not exceed the deposit + top-up. No onchain transaction occurs at this stage.

**Request:**

```json
{
  "x402Version": 2,
  "paymentPayload": "« PAYMENT-SIGNATURE above »",
  "paymentRequirements": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "100000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xFacilitatorSignerAddress"
    }
  }
}
```

**Response:**

```json
{
  "isValid": true,
  "payer": "0xClientAddress"
}
```

### Server → Facilitator: `POST /settle` — top up channel onchain

After verification succeeds, the server calls `/settle`. The facilitator sees `payload.type: "topUp"` and calls `topUpWithERC3009()`, depositing an additional $0.50 into the channel onchain.

**Request:**

```json
{
  "x402Version": 2,
  "paymentPayload": "« PAYMENT-SIGNATURE above »",
  "paymentRequirements": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "100000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xFacilitatorSignerAddress"
    }
  }
}
```

**Response:**

```json
{
  "success": true,
  "transaction": "0x...topUpWithERC3009 txHash",
  "network": "eip155:8453",
  "payer": "0xClientAddress",
  "extra": {
    "channelId": "0xabc123...channelId",
    "cumulativeAmount": "1100000",
    "deposit": "1500000"
  }
}
```

### `PAYMENT-RESPONSE` header (base64-decoded)

```json
{
  "success": true,
  "transaction": "0x...topUpWithERC3009 txHash",
  "network": "eip155:8453",
  "payer": "0xClientAddress",
  "extra": {
    "channelId": "0xabc123...channelId",
    "cumulativeAmount": "1100000",
    "deposit": "1500000"
  }
}
```

> Channel state: deposit = $1.50, spent = $1.10, remaining = $0.40 (4 more requests)

---

## Step 5: Close — Client Signs Final Voucher for $1.20 and Requests Channel Closure

The client makes one more request and signals it is done by setting `requestClose: true`. The server verifies the voucher, serves the content, then tells the facilitator to close the channel. The contract settles $1.20 to the server and refunds $0.30 to the client.

### `PAYMENT-REQUIRED` header (base64-decoded)

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "accepts": [
    {
      "scheme": "session",
      "network": "eip155:8453",
      "amount": "100000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xServerPayeeAddress",
      "maxTimeoutSeconds": 3600,
      "extra": {
        "authorizedSettler": "0xFacilitatorSignerAddress",
        "channelId": "0xabc123...channelId",
        "cumulativeAmount": "1100000",
        "deposit": "1500000"
      }
    }
  ]
}
```

> Client computes: 1100000 + 100000 = 1200000 ≤ 1500000 → no top-up needed.
> Client is done and sets `requestClose: true`.

### `PAYMENT-SIGNATURE` header (base64-decoded)

```json
{
  "x402Version": 2,
  "accepted": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "100000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xFacilitatorSignerAddress",
      "channelId": "0xabc123...channelId",
      "cumulativeAmount": "1100000",
      "deposit": "1500000"
    }
  },
  "payload": {
    "type": "voucher",
    "channelId": "0xabc123...channelId",
    "cumulativeAmount": "1200000",
    "signature": "0x...EIP-712 Voucher signature (cumulative $1.20)",
    "requestClose": true
  }
}
```

### Server → Facilitator: `POST /verify` — check voucher signature

**Request:**

```json
{
  "x402Version": 2,
  "paymentPayload": {
    "x402Version": 2,
    "accepted": {
      "scheme": "session",
      "network": "eip155:8453",
      "amount": "100000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xServerPayeeAddress",
      "maxTimeoutSeconds": 3600,
      "extra": {
        "authorizedSettler": "0xFacilitatorSignerAddress",
        "channelId": "0xabc123...channelId",
        "cumulativeAmount": "1100000",
        "deposit": "1500000"
      }
    },
    "payload": {
      "type": "voucher",
      "channelId": "0xabc123...channelId",
      "cumulativeAmount": "1200000",
      "signature": "0x...EIP-712 Voucher signature (cumulative $1.20)",
      "requestClose": true
    }
  },
  "paymentRequirements": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "100000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xFacilitatorSignerAddress"
    }
  }
}
```

**Response:**

```json
{
  "isValid": true,
  "payer": "0xClientAddress"
}
```

### Server → Facilitator: `POST /settle` — close channel onchain

The facilitator sees `requestClose: true` in the voucher payload and calls `close(channelId, 1200000, voucherSignature)` as the `authorizedSettler`. The contract settles the final amount to the server and refunds the remainder to the client.

**Request:**

```json
{
  "x402Version": 2,
  "paymentPayload": "« PAYMENT-SIGNATURE above »",
  "paymentRequirements": {
    "scheme": "session",
    "network": "eip155:8453",
    "amount": "100000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xServerPayeeAddress",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "authorizedSettler": "0xFacilitatorSignerAddress"
    }
  }
}
```

**Response:**

```json
{
  "success": true,
  "transaction": "0x...close txHash",
  "network": "eip155:8453",
  "payer": "0xClientAddress"
}
```

> Onchain result of `close()`:
> - $1.20 (1200000) settled to `0xServerPayeeAddress`
> - $0.30 (300000) refunded to `0xClientAddress`
> - Channel marked as `finalized`

### `PAYMENT-RESPONSE` header (base64-decoded)

```json
{
  "success": true,
  "transaction": "0x...close txHash",
  "network": "eip155:8453",
  "payer": "0xClientAddress"
}
```

> Session complete. Total: 12 requests, $1.20 paid, $0.30 refunded. Three onchain transactions total (open, topUp, close).
