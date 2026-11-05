// SPDX-License-Identifier: MIT
// AI-assisted: Codex. See AI_USAGE.md.
pragma solidity ^0.8.28;

library Attestations {
    struct HumanAttestation {
        address account;
        bytes32 nullifierHash;
        uint64 issuedAt;
        uint64 expiresAt;
    }

    struct BalanceAttestation {
        bytes32 voucherHash;
        bytes32 issuerId;
        bytes32 brandId;
        uint256 balancePaise;
        bool redeemed;
        uint64 lastRedeemedAt;
        uint64 observedAt;
        bytes32 proofRef;
    }
    bytes32 internal constant HUMAN_TYPEHASH =
        keccak256("HumanAttestation(address account,bytes32 nullifierHash,uint64 issuedAt,uint64 expiresAt)");
    bytes32 internal constant BALANCE_TYPEHASH = keccak256(
        "BalanceAttestation(bytes32 voucherHash,bytes32 issuerId,bytes32 brandId,uint256 balancePaise,bool redeemed,uint64 lastRedeemedAt,uint64 observedAt,bytes32 proofRef)"
    );
    bytes32 internal constant ORDER_TYPEHASH =
        keccak256("BalanceForOrder(bytes32 orderId,bytes32 attestationHash,uint8 purpose)");

    function humanHash(HumanAttestation memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(HUMAN_TYPEHASH, a.account, a.nullifierHash, a.issuedAt, a.expiresAt));
    }

    function balanceHash(BalanceAttestation memory a) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                BALANCE_TYPEHASH,
                a.voucherHash,
                a.issuerId,
                a.brandId,
                a.balancePaise,
                a.redeemed,
                a.lastRedeemedAt,
                a.observedAt,
                a.proofRef
            )
        );
    }

    function orderHash(bytes32 id, BalanceAttestation memory a, uint8 purpose) internal pure returns (bytes32) {
        return keccak256(abi.encode(ORDER_TYPEHASH, id, balanceHash(a), purpose));
    }
}
