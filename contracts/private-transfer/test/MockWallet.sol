// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev TEST ONLY. Minimal ERC-1271 smart wallet: accepts a signature only if the test pre-approved exactly those bytes for the digest.
contract MockWallet {
    mapping(bytes32 => bytes32) public approvedSigHash;

    function approve(bytes32 digest, bytes calldata sig) external {
        approvedSigHash[digest] = keccak256(sig);
    }

    function isValidSignature(bytes32 digest, bytes calldata sig) external view returns (bytes4) {
        bytes32 a = approvedSigHash[digest];
        return (a != bytes32(0) && a == keccak256(sig)) ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
