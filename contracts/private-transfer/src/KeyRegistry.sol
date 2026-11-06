// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title KeyRegistry
/// @notice Public directory of encryption public keys (X25519, 32 bytes) used to seal voucher codes to a wallet.
/// @dev The registration is a transaction sent by the owner's own wallet, so msg.sender already proves the key
/// belongs to that wallet: no signature check is needed and the directory cannot be spoofed by any server.
/// A user may replace their key (rotation); deliveries name the key id they were sealed to, so old ones stay decryptable
/// with the old key. No admin, no upgrade, no funds.
contract KeyRegistry {
    struct Key {
        bytes32 publicKey;
        uint64 setAt;
    }

    mapping(address => Key) private _keys;

    event KeySet(address indexed owner, bytes8 indexed keyId, bytes32 publicKey);

    error ZeroKey();

    /// @notice Short id of a key: the first 8 bytes of sha256(publicKey) (the same id the off-chain SDK uses).
    function keyId(bytes32 publicKey) public pure returns (bytes8) {
        return bytes8(sha256(abi.encodePacked(publicKey)));
    }

    /// @notice Register or replace the caller's encryption public key.
    function setKey(bytes32 publicKey) external {
        if (publicKey == bytes32(0)) revert ZeroKey();
        _keys[msg.sender] = Key(publicKey, uint64(block.timestamp));
        emit KeySet(msg.sender, keyId(publicKey), publicKey);
    }

    /// @notice The public key registered by `owner` (zero if none) and when it was set.
    function keyOf(address owner) external view returns (bytes32 publicKey, uint64 setAt) {
        Key memory k = _keys[owner];
        return (k.publicKey, k.setAt);
    }

    /// @notice The key id currently registered for `owner` (zero if none).
    function currentKeyId(address owner) external view returns (bytes8) {
        bytes32 pk = _keys[owner].publicKey;
        return pk == bytes32(0) ? bytes8(0) : keyId(pk);
    }
}
