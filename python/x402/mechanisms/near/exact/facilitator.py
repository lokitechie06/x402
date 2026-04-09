"""NEAR facilitator implementation for the Exact payment scheme."""

from __future__ import annotations

import base64
import json
import time
from typing import Any

from ....schemas import (
    Network,
    PaymentPayload,
    PaymentRequirements,
    SettleResponse,
    VerifyResponse,
)
from ..constants import (
    ERR_AMOUNT_MISMATCH,
    ERR_ARGS_DECODE_FAILED,
    ERR_BLOCK_FETCH_FAILED,
    ERR_DUPLICATE_SETTLEMENT,
    ERR_INVALID_NONCE,
    ERR_INVALID_PAYLOAD_MISSING_FIELDS,
    ERR_INVALID_SENDER_ID,
    ERR_INVALID_TX_HASH,
    ERR_NETWORK_MISMATCH,
    ERR_NONCE_MISMATCH,
    ERR_RECIPIENT_MISMATCH,
    ERR_SEND_FAILED,
    ERR_SIGNER_MISMATCH,
    ERR_TOKEN_CONTRACT_MISMATCH,
    ERR_TRANSACTION_EXPIRED,
    ERR_TRANSACTION_FAILED,
    ERR_TRANSACTION_NOT_FOUND,
    ERR_UNEXPECTED_ACTIONS,
    ERR_UNSUPPORTED_SCHEME,
    ERR_WRONG_METHOD,
    SCHEME_EXACT,
)
from ..settlement_cache import SettlementCache
from ..signer import FacilitatorNearSigner
from ..types import ExactNearPayload, FtTransferArgs
from ..utils import (
    get_block,
    get_block_timestamp_seconds,
    get_rpc_url,
    get_transaction,
    validate_near_account_id,
    validate_near_tx_hash,
    validate_nonce,
)


class ExactNearScheme:
    """NEAR facilitator implementation for the Exact payment scheme.

    The NEAR exact scheme uses a client-settles model: the client submits the
    ft_transfer transaction, and the facilitator verifies it on-chain.
    Settlement is confirmation-only — no new transactions are submitted.

    Attributes:
        scheme: The scheme identifier ("exact").
        caip_family: The CAIP family pattern ("near:*").
    """

    scheme = SCHEME_EXACT
    caip_family = "near:*"

    def __init__(
        self,
        signer: FacilitatorNearSigner,
        settlement_cache: SettlementCache | None = None,
    ) -> None:
        """Create ExactNearScheme facilitator.

        Args:
            signer: Facilitator identity and optional RPC config.
            settlement_cache: Optional shared settlement cache.
        """
        self._signer = signer
        self._settlement_cache = settlement_cache or SettlementCache()

    def get_extra(self, network: Network) -> dict[str, Any] | None:
        """Return None — NEAR clients pay their own gas, no feePayer needed."""
        return None

    def get_signers(self, network: Network) -> list[str]:
        """Return the facilitator's NEAR account ID for identification."""
        return [self._signer.account_id]

    def verify(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
        context: Any = None,
    ) -> VerifyResponse:
        """Verify a NEAR payment by looking up the transaction on-chain.

        Args:
            payload: Payment payload containing the transaction hash.
            requirements: Expected payment requirements.
            context: Unused.

        Returns:
            VerifyResponse indicating whether the payment is valid.
        """
        # Scheme and network checks
        if payload.accepted.scheme != SCHEME_EXACT or requirements.scheme != SCHEME_EXACT:
            return VerifyResponse(is_valid=False, invalid_reason=ERR_UNSUPPORTED_SCHEME, payer="")

        if str(payload.accepted.network) != str(requirements.network):
            return VerifyResponse(is_valid=False, invalid_reason=ERR_NETWORK_MISMATCH, payer="")

        near_payload = ExactNearPayload.from_dict(payload.payload)

        # Validate payload structure
        structure_error = self._validate_payload_structure(near_payload)
        if structure_error:
            return VerifyResponse(is_valid=False, invalid_reason=structure_error, payer="")

        payer = near_payload.sender_id
        network = str(requirements.network)

        # Resolve RPC URL
        rpc_url = self._signer.get_rpc_url(network) or get_rpc_url(network)

        # Fetch transaction from NEAR RPC
        try:
            tx_result = get_transaction(rpc_url, near_payload.transaction_hash, near_payload.sender_id)
        except RuntimeError:
            return VerifyResponse(is_valid=False, invalid_reason=ERR_TRANSACTION_NOT_FOUND, payer=payer)

        # Verify transaction succeeded
        status = tx_result.get("status", {})
        if not isinstance(status, dict) or "SuccessValue" not in status:
            return VerifyResponse(is_valid=False, invalid_reason=ERR_TRANSACTION_FAILED, payer=payer)

        tx = tx_result.get("transaction", {})

        # Verify signer matches senderId
        if tx.get("signer_id") != near_payload.sender_id:
            return VerifyResponse(is_valid=False, invalid_reason=ERR_SIGNER_MISMATCH, payer=payer)

        # Verify token contract (receiver_id of the transaction)
        if tx.get("receiver_id") != requirements.asset:
            return VerifyResponse(is_valid=False, invalid_reason=ERR_TOKEN_CONTRACT_MISMATCH, payer=payer)

        # Validate FunctionCall action
        action_error = self._validate_function_call(tx.get("actions", []), requirements, near_payload.nonce)
        if action_error:
            return VerifyResponse(is_valid=False, invalid_reason=action_error, payer=payer)

        # Validate transaction age
        if requirements.max_timeout_seconds:
            block_hash = tx_result.get("transaction_outcome", {}).get("block_hash", "")
            age_error = self._validate_transaction_age(rpc_url, block_hash, requirements.max_timeout_seconds)
            if age_error:
                return VerifyResponse(is_valid=False, invalid_reason=age_error, payer=payer)

        return VerifyResponse(is_valid=True, payer=payer)

    def settle(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
        context: Any = None,
    ) -> SettleResponse:
        """Settle a NEAR payment — re-verifies and returns the existing transaction hash.

        Since the client already submitted the transaction, settlement is confirmation-only.

        Args:
            payload: Payment payload.
            requirements: Payment requirements.
            context: Unused.

        Returns:
            SettleResponse with the transaction hash.
        """
        near_payload = ExactNearPayload.from_dict(payload.payload)
        tx_hash = near_payload.transaction_hash
        network = str(payload.accepted.network)

        verify_result = self.verify(payload, requirements, context)
        if not verify_result.is_valid:
            return SettleResponse(
                success=False,
                error_reason=verify_result.invalid_reason,
                network=network,
                payer=verify_result.payer or "",
                transaction="",
            )

        # Duplicate settlement check
        if self._settlement_cache.is_duplicate(tx_hash):
            return SettleResponse(
                success=False,
                error_reason=ERR_DUPLICATE_SETTLEMENT,
                network=network,
                payer=verify_result.payer or "",
                transaction="",
            )

        return SettleResponse(
            success=True,
            transaction=tx_hash,
            network=network,
            payer=verify_result.payer,
        )

    # --- Private helpers ---

    def _validate_payload_structure(self, near_payload: ExactNearPayload) -> str | None:
        if not near_payload.transaction_hash or not near_payload.sender_id or not near_payload.nonce:
            return ERR_INVALID_PAYLOAD_MISSING_FIELDS
        if not validate_near_tx_hash(near_payload.transaction_hash):
            return ERR_INVALID_TX_HASH
        if not validate_near_account_id(near_payload.sender_id):
            return ERR_INVALID_SENDER_ID
        if not validate_nonce(near_payload.nonce):
            return ERR_INVALID_NONCE
        return None

    def _validate_function_call(
        self,
        actions: list[dict],
        requirements: PaymentRequirements,
        nonce: str,
    ) -> str | None:
        fc_actions = [a for a in actions if "FunctionCall" in a]

        if len(fc_actions) != 1:
            return ERR_UNEXPECTED_ACTIONS

        fc = fc_actions[0]["FunctionCall"]

        if fc.get("method_name") != "ft_transfer":
            return ERR_WRONG_METHOD

        # Decode base64-encoded args
        try:
            args_bytes = base64.b64decode(fc["args"])
            args = FtTransferArgs.from_dict(json.loads(args_bytes.decode("utf-8")))
        except Exception:
            return ERR_ARGS_DECODE_FAILED

        if args.receiver_id != requirements.pay_to:
            return ERR_RECIPIENT_MISMATCH

        if args.amount != requirements.amount:
            return ERR_AMOUNT_MISMATCH

        if args.memo != nonce:
            return ERR_NONCE_MISMATCH

        return None

    def _validate_transaction_age(
        self,
        rpc_url: str,
        block_hash: str,
        max_timeout_seconds: int,
    ) -> str | None:
        try:
            block = get_block(rpc_url, block_hash)
            block_ts = get_block_timestamp_seconds(block)
            now = time.time()
            if now - block_ts > max_timeout_seconds:
                return ERR_TRANSACTION_EXPIRED
        except (RuntimeError, KeyError, ValueError):
            return ERR_BLOCK_FETCH_FAILED
        return None
