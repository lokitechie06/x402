"""NEAR client implementation for the Exact payment scheme."""

from __future__ import annotations

import os
from typing import Any

from ....schemas import PaymentRequirements
from ..constants import SCHEME_EXACT
from ..signer import ClientNearSigner
from ..types import ExactNearPayload
from ..utils import validate_nonce


def _generate_nonce() -> str:
    """Generate a cryptographically random 16-byte nonce as a lowercase hex string."""
    return os.urandom(16).hex()


class ExactNearScheme:
    """NEAR client implementation for the Exact payment scheme.

    Because NEAR does not support delegated transfers, the client signs and
    broadcasts the ft_transfer transaction themselves. ``create_payment_payload``
    executes the on-chain transfer and returns the transaction hash as proof.

    Attributes:
        scheme: The scheme identifier ("exact").
    """

    scheme = SCHEME_EXACT

    def __init__(self, signer: ClientNearSigner) -> None:
        """Create ExactNearScheme client.

        Args:
            signer: NEAR signer for executing ft_transfer transactions.
        """
        self._signer = signer

    def create_payment_payload(self, requirements: PaymentRequirements) -> dict[str, Any]:
        """Execute ft_transfer on-chain and return the payment payload dict.

        This method:
        1. Generates a random nonce.
        2. Submits an ft_transfer to the USDC contract with the nonce as memo.
        3. Returns the transaction hash as proof of payment.

        Args:
            requirements: Payment requirements from the resource server.

        Returns:
            Inner payload dict (transactionHash, senderId, nonce).
            x402Client wraps this with x402_version, accepted, resource fields.
        """
        nonce = _generate_nonce()

        tx_hash = self._signer.ft_transfer(
            contract_id=requirements.asset,
            receiver_id=requirements.pay_to,
            amount=requirements.amount,
            memo=nonce,
        )

        payload = ExactNearPayload(
            transaction_hash=tx_hash,
            sender_id=self._signer.account_id,
            nonce=nonce,
        )

        return payload.to_dict()
