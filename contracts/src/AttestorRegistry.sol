// SPDX-License-Identifier: MIT
// AI-assisted: Codex. See AI_USAGE.md.
pragma solidity ^0.8.28;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// Configuration changes create a new epoch; existing orders keep their original trust set.
contract AttestorRegistry is Ownable2Step {
    struct Epoch {
        uint16 threshold;
        uint64 maxAge;
    }
    uint64 public currentEpoch;
    address public identitySigner;
    mapping(uint64 => Epoch) public epochs;
    mapping(uint64 => mapping(address => bool)) public allowed;
    event Configured(uint64 indexed epoch, address[] signers, uint16 threshold, uint64 maxAge, address identitySigner);

    constructor(address owner_, address[] memory signers, uint16 threshold_, uint64 age, address identity_)
        Ownable(owner_)
    {
        _configure(signers, threshold_, age, identity_);
    }

    function configure(address[] calldata signers, uint16 threshold_, uint64 age, address identity_)
        external
        onlyOwner
    {
        _configure(signers, threshold_, age, identity_);
    }

    function _configure(address[] memory signers, uint16 threshold_, uint64 age, address identity_) private {
        require(
            signers.length > 0 && signers.length <= 32 && threshold_ > 0 && threshold_ <= signers.length && age >= 30
                && age <= 1 days && identity_ != address(0),
            "Invalid trust configuration"
        );
        uint64 e = ++currentEpoch;
        address prior;
        for (uint256 i; i < signers.length; i++) {
            require(signers[i] > prior, "Signers must be unique and sorted");
            allowed[e][signers[i]] = true;
            prior = signers[i];
        }
        epochs[e] = Epoch(threshold_, age);
        identitySigner = identity_;
        emit Configured(e, signers, threshold_, age, identity_);
    }

    function verify(uint64 epoch, bytes32 digest, bytes[] calldata signatures) external view {
        Epoch memory e = epochs[epoch];
        require(
            e.threshold > 0 && signatures.length >= e.threshold && signatures.length <= 32, "Insufficient attestations"
        );
        address prior;
        for (uint256 i; i < signatures.length; i++) {
            address signer = ECDSA.recover(digest, signatures[i]);
            require(signer > prior && allowed[epoch][signer], "Untrusted or repeated signer");
            prior = signer;
        }
    }
}
