// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVaultVerifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[5] calldata signals) external view returns (bool);
}

/// Public integrity anchors, not storage of voucher codes or payment credentials.
contract VaultRegistry {
    uint256 private constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    IVaultVerifier public immutable verifier;
    uint256 public immutable scope;
    struct Anchor { address owner; uint64 created; uint256 digest; }
    mapping(uint256 => Anchor) public anchors;
    mapping(uint256 => bool) public usedNullifiers;
    event Anchored(uint256 indexed commitment, address indexed owner, uint256 digest);
    error InvalidProof();
    constructor(address verifier_) {
        require(verifier_.code.length > 0, "Missing verifier");
        verifier = IVaultVerifier(verifier_);
        scope = uint256(keccak256(abi.encode("NetPositive:Vault:v1", block.chainid, address(this)))) % FIELD;
    }
    function anchor(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[5] calldata s) external {
        if (s[3] != uint256(uint160(msg.sender)) || s[4] != scope || s[0] == 0 || s[1] == 0 ||
            anchors[s[0]].owner != address(0) || usedNullifiers[s[1]]) revert InvalidProof();
        if (!verifier.verifyProof(a, b, c, s)) revert InvalidProof();
        anchors[s[0]] = Anchor(msg.sender, uint64(block.timestamp), s[2]);
        usedNullifiers[s[1]] = true;
        emit Anchored(s[0], msg.sender, s[2]);
    }
}
