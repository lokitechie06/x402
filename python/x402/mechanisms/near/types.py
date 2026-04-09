"""NEAR mechanism types."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class ExactNearPayload:
    """Payload for the NEAR exact scheme.

    Contains proof of an already-executed on-chain ft_transfer.
    """

    transaction_hash: str
    """Base58-encoded NEAR transaction hash of the submitted ft_transfer."""

    sender_id: str
    """NEAR account ID of the payer (transaction signer)."""

    nonce: str
    """16-byte random nonce, hex-encoded (32 characters), embedded in the ft_transfer memo."""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ExactNearPayload":
        """Parse payload from a dictionary (e.g. PaymentPayload.payload)."""
        return cls(
            transaction_hash=data.get("transactionHash", ""),
            sender_id=data.get("senderId", ""),
            nonce=data.get("nonce", ""),
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize payload to a dictionary."""
        return {
            "transactionHash": self.transaction_hash,
            "senderId": self.sender_id,
            "nonce": self.nonce,
        }


@dataclass
class FtTransferArgs:
    """Decoded arguments of a NEAR ft_transfer call."""

    receiver_id: str
    amount: str
    memo: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "FtTransferArgs":
        return cls(
            receiver_id=data.get("receiver_id", ""),
            amount=data.get("amount", ""),
            memo=data.get("memo"),
        )
