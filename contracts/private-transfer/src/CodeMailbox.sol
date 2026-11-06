// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {KeyRegistry} from "./KeyRegistry.sol";

/// @dev The one view of the deployed VoucherEscrow that the mailbox needs.
interface IEscrowView {
    /// @return depositor The wallet that locked the USDC (the requester).
    /// @return amount    Locked amount in base units.
    /// @return status    0 None, 1 Funded, 2 Released, 3 Refunded.
    function escrows(bytes32 id) external view returns (address depositor, uint256 amount, uint8 status);
}

/// @title CodeMailbox
/// @notice Private, timestamped hand-over of a voucher code from a fulfiller to the requester.
///
/// What it does: the fulfiller seals the code and PIN to the requester's registered public key OFF-CHAIN and submits only
/// the ciphertext. The mailbox (1) checks the escrow is funded and the recipient is its depositor, (2) checks the
/// requester's signed "Ready" permit naming this fulfiller, (3) checks the ciphertext names the requester's CURRENT key,
/// then records the ciphertext hash and the block time and emits the ciphertext in an event.
///
/// What it does NOT do: it cannot read the code, cannot tell that the ciphertext really decrypts to a working voucher,
/// cannot move the escrow (the deployed escrow only lets its operator release), and it keeps the ciphertext public forever
/// (it is encrypted; the code is short-lived). The sender, recipient, time and size are public.
///
/// No admin, no upgrade, no funds. One delivery per escrow id.
contract CodeMailbox is EIP712 {
    struct Delivery {
        address fulfiller;
        address recipient;
        uint64 deliveredAt;
        bytes8 keyId;
        bytes32 ciphertextHash;
    }

    /// @notice Typed data the requester signs (gasless) to say "I am ready, and this fulfiller may deliver until validUntil".
    bytes32 public constant READY_TYPEHASH = keccak256("Ready(bytes32 escrowId,address fulfiller,uint64 validUntil)");
    uint256 public constant MAX_CIPHERTEXT_BYTES = 4096;

    IEscrowView public immutable escrow;
    KeyRegistry public immutable registry;

    /// @dev Keyed by the escrow id (keccak256 of the request id string), the same id the escrow uses.
    mapping(bytes32 => Delivery) public deliveries;

    event Delivered(
        bytes32 indexed escrowId,
        address indexed fulfiller,
        address indexed recipient,
        bytes8 keyId,
        bytes32 ciphertextHash,
        uint64 deliveredAt,
        bytes ciphertext
    );

    error AlreadyDelivered();
    error PermitExpired();
    error EscrowNotFunded();
    error BadPermit();
    error NoRecipientKey();
    error WrongKey();
    error BadCiphertextSize();
    error ZeroAddress();

    constructor(IEscrowView escrow_, KeyRegistry registry_) EIP712("NetPositiveCodeMailbox", "1") {
        if (address(escrow_) == address(0) || address(registry_) == address(0)) revert ZeroAddress();
        escrow = escrow_;
        registry = registry_;
    }

    /// @notice The EIP-712 digest the requester must sign for `fulfiller` (exposed so clients sign exactly what is verified).
    function readyDigest(bytes32 escrowId, address fulfiller, uint64 validUntil) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(READY_TYPEHASH, escrowId, fulfiller, validUntil)));
    }

    /// @notice Deliver a sealed voucher to the escrow's depositor. msg.sender is the fulfiller named in the permit.
    /// @param escrowId   keccak256(requestId), as used by the escrow.
    /// @param keyId_     Id of the recipient key the ciphertext was sealed to (must be their current registered key).
    /// @param ciphertext Opaque sealed envelope (the SDK's JSON envelope as UTF-8 bytes), 1..4096 bytes.
    /// @param validUntil Permit expiry (unix seconds), signed by the requester.
    /// @param readySig   Requester's signature over readyDigest (EOA or ERC-1271 smart wallet).
    function deliver(bytes32 escrowId, bytes8 keyId_, bytes calldata ciphertext, uint64 validUntil, bytes calldata readySig)
        external
    {
        if (ciphertext.length == 0 || ciphertext.length > MAX_CIPHERTEXT_BYTES) revert BadCiphertextSize();
        address depositor = _authorize(escrowId, keyId_, validUntil, readySig);

        bytes32 h = keccak256(ciphertext);
        uint64 nowTs = uint64(block.timestamp);
        deliveries[escrowId] = Delivery(msg.sender, depositor, nowTs, keyId_, h);
        emit Delivered(escrowId, msg.sender, depositor, keyId_, h, nowTs, ciphertext);
    }

    /// @dev All the checks that do not involve the ciphertext. Returns the requester (the escrow's depositor).
    function _authorize(bytes32 escrowId, bytes8 keyId_, uint64 validUntil, bytes calldata readySig)
        private
        view
        returns (address depositor)
    {
        if (deliveries[escrowId].deliveredAt != 0) revert AlreadyDelivered();
        if (block.timestamp > validUntil) revert PermitExpired();

        uint8 status;
        (depositor,, status) = escrow.escrows(escrowId);
        if (status != 1 || depositor == address(0)) revert EscrowNotFunded();

        if (!SignatureChecker.isValidSignatureNow(depositor, readyDigest(escrowId, msg.sender, validUntil), readySig)) {
            revert BadPermit();
        }

        bytes8 current = registry.currentKeyId(depositor);
        if (current == bytes8(0)) revert NoRecipientKey();
        if (current != keyId_) revert WrongKey();
    }

    /// @notice True if `ciphertext` is exactly what was delivered for `escrowId` (check event data against the stored hash).
    function matches(bytes32 escrowId, bytes calldata ciphertext) external view returns (bool) {
        Delivery storage d = deliveries[escrowId];
        return d.deliveredAt != 0 && d.ciphertextHash == keccak256(ciphertext);
    }
}
