// SPDX-License-Identifier: MIT
// AI-assisted: Codex. See AI_USAGE.md.
pragma solidity ^0.8.28;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {AttestorRegistry} from "./AttestorRegistry.sol";
import {Attestations} from "./lib/Attestations.sol";

contract IdentityRegistry is Ownable2Step, EIP712 {
    AttestorRegistry public immutable attestors;
    address public escrow;
    mapping(address => bytes32) public nullifierOf;
    mapping(bytes32 => address) public accountOf;
    mapping(bytes32 => bool) public bannedNullifiers;
    mapping(address => uint64) public validUntil;
    event Registered(address indexed account, bytes32 indexed nullifier, uint64 expiresAt);
    event Banned(address indexed account, bytes32 indexed nullifier);
    event EscrowBound(address indexed escrow);

    constructor(address owner_, AttestorRegistry registry) Ownable(owner_) EIP712("NetPositive", "1") {
        attestors = registry;
    }

    function bindEscrow(address escrow_) external onlyOwner {
        require(escrow == address(0) && escrow_.code.length > 0, "Escrow already bound or absent");
        escrow = escrow_;
        emit EscrowBound(escrow_);
    }

    function digest(Attestations.HumanAttestation calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(Attestations.humanHash(a));
    }

    function register(Attestations.HumanAttestation calldata a, bytes calldata sig) external {
        require(
            a.account == msg.sender && a.nullifierHash != bytes32(0) && a.issuedAt <= block.timestamp
                && a.expiresAt > block.timestamp && a.expiresAt <= a.issuedAt + 1 days,
            "Invalid human context"
        );
        require(
            !bannedNullifiers[a.nullifierHash]
                && (accountOf[a.nullifierHash] == address(0) || accountOf[a.nullifierHash] == msg.sender),
            "Human already linked or banned"
        );
        require(
            nullifierOf[msg.sender] == bytes32(0) || nullifierOf[msg.sender] == a.nullifierHash,
            "Identity replacement refused"
        );
        require(a.expiresAt > validUntil[msg.sender], "Stale identity attestation");
        require(
            SignatureChecker.isValidSignatureNow(attestors.identitySigner(), digest(a), sig),
            "Invalid identity signature"
        );
        nullifierOf[msg.sender] = a.nullifierHash;
        accountOf[a.nullifierHash] = msg.sender;
        validUntil[msg.sender] = a.expiresAt;
        emit Registered(msg.sender, a.nullifierHash, a.expiresAt);
    }

    function isBanned(address account) public view returns (bool) {
        bytes32 n = nullifierOf[account];
        return n != bytes32(0) && bannedNullifiers[n];
    }

    function isVerified(address account) public view returns (bool) {
        return validUntil[account] > block.timestamp && !isBanned(account);
    }

    function ban(address account) external {
        require(msg.sender == escrow, "Only escrow");
        bytes32 n = nullifierOf[account];
        require(n != bytes32(0), "No registered identity");
        bannedNullifiers[n] = true;
        emit Banned(account, n);
    }
}
