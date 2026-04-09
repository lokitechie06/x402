"""NEAR mechanism constants — network configs, USDC addresses, error codes."""

# Scheme identifier
SCHEME_EXACT = "exact"

# Default token decimals for USDC on NEAR
DEFAULT_DECIMALS = 6

# NEAR RPC endpoints
NEAR_MAINNET_RPC_URL = "https://rpc.mainnet.near.org"
NEAR_TESTNET_RPC_URL = "https://rpc.testnet.near.org"

# USDC NEP-141 token contract account IDs
# Mainnet: Native USDC bridged via Circle (Wormhole)
# Testnet: Fake USDC for testing purposes
USDC_MAINNET_ADDRESS = "17208628f84f5d6ad33f0da3bbbeb27ffed7bc96e875c955409ce0a82620f408"
USDC_TESTNET_ADDRESS = "usdc.fakes.testnet"

# CAIP-2 network identifiers for NEAR
NEAR_MAINNET_CAIP2 = "near:mainnet"
NEAR_TESTNET_CAIP2 = "near:testnet"

# Gas for ft_transfer calls (in gas units — 30 TGas is standard for NEP-141)
FT_TRANSFER_GAS = 30_000_000_000_000

# 1 yoctoNEAR required deposit for ft_transfer (NEP-141 security requirement)
FT_TRANSFER_DEPOSIT = 1

# How long to hold transaction hashes in the duplicate settlement cache (seconds)
SETTLEMENT_TTL_SECONDS = 600  # 10 minutes

# NEAR account ID validation pattern
NEAR_ACCOUNT_ID_REGEX = (
    r"^(([a-z\d]([a-z\d\-_]*[a-z\d])?\.)+[a-z\d]([a-z\d\-_]*[a-z\d])?|[a-f\d]{64})$"
)

# NEAR transaction hash validation (base58, 43-44 characters)
NEAR_TX_HASH_REGEX = r"^[1-9A-HJ-NP-Za-km-z]{43,44}$"

# Nonce hex string validation (exactly 32 hex characters = 16 bytes)
NONCE_HEX_REGEX = r"^[0-9a-f]{32}$"

# Error codes
ERR_UNSUPPORTED_SCHEME = "unsupported_scheme"
ERR_NETWORK_MISMATCH = "network_mismatch"
ERR_INVALID_PAYLOAD_MISSING_FIELDS = "invalid_near_payload_missing_fields"
ERR_INVALID_TX_HASH = "invalid_near_payload_transaction_hash"
ERR_INVALID_SENDER_ID = "invalid_near_payload_sender_id"
ERR_INVALID_NONCE = "invalid_near_payload_nonce"
ERR_TRANSACTION_NOT_FOUND = "transaction_not_found"
ERR_TRANSACTION_FAILED = "transaction_failed_or_pending"
ERR_SIGNER_MISMATCH = "signer_mismatch"
ERR_TOKEN_CONTRACT_MISMATCH = "token_contract_mismatch"
ERR_UNEXPECTED_ACTIONS = "invalid_near_payload_unexpected_actions"
ERR_WRONG_METHOD = "invalid_near_payload_wrong_method"
ERR_ARGS_DECODE_FAILED = "invalid_near_payload_args_decode_failed"
ERR_RECIPIENT_MISMATCH = "invalid_near_payload_recipient_mismatch"
ERR_AMOUNT_MISMATCH = "invalid_near_payload_amount_mismatch"
ERR_NONCE_MISMATCH = "invalid_near_payload_nonce_mismatch"
ERR_TRANSACTION_EXPIRED = "transaction_expired"
ERR_BLOCK_FETCH_FAILED = "block_fetch_failed"
ERR_DUPLICATE_SETTLEMENT = "duplicate_settlement"
ERR_SEND_FAILED = "transaction_send_failed"
