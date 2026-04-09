"""NEAR signer protocol definitions."""

from __future__ import annotations

from typing import Protocol


class ClientNearSigner(Protocol):
    """Client-side NEAR signer for executing ft_transfer payments.

    Implement this protocol to integrate with your NEAR wallet or key management system.
    The signer must be able to sign and submit ft_transfer transactions.
    """

    @property
    def account_id(self) -> str:
        """The signer's NEAR account ID (e.g. 'alice.near').

        Returns:
            NEAR account ID string.
        """
        ...

    def ft_transfer(
        self,
        contract_id: str,
        receiver_id: str,
        amount: str,
        memo: str,
    ) -> str:
        """Execute an ft_transfer call and return the transaction hash.

        Signs and submits a NEP-141 ft_transfer to the NEAR network.
        The transfer must include 1 yoctoNEAR as attached deposit.

        Args:
            contract_id: NEP-141 token contract account ID (e.g. USDC contract).
            receiver_id: Recipient NEAR account ID.
            amount: Token amount in smallest units as a string.
            memo: Nonce string to embed in the transfer memo for replay protection.

        Returns:
            Base58-encoded transaction hash of the submitted transaction.
        """
        ...


class FacilitatorNearSigner(Protocol):
    """Facilitator-side NEAR identity for verification.

    The NEAR exact scheme uses a client-settles model, so the facilitator does not
    need a private key — it only reads from the chain via RPC.
    This interface carries the facilitator's NEAR account ID (for identification)
    and optional per-network RPC URL overrides.
    """

    @property
    def account_id(self) -> str:
        """The facilitator's NEAR account ID (e.g. 'facilitator.near').

        Returns:
            NEAR account ID string.
        """
        ...

    def get_rpc_url(self, network: str) -> str | None:
        """Get an optional custom RPC URL for a given CAIP-2 network.

        Return None to use the default public RPC for that network.

        Args:
            network: CAIP-2 network identifier (e.g. 'near:mainnet').

        Returns:
            Custom RPC URL string, or None to use the default.
        """
        ...
