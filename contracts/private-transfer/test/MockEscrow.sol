// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev TEST ONLY. Same read interface as the deployed VoucherEscrow, with a setter so tests can create any state.
contract MockEscrow {
    struct E {
        address depositor;
        uint256 amount;
        uint8 status;
    }

    mapping(bytes32 => E) public escrows;

    function set(bytes32 id, address depositor, uint256 amount, uint8 status) external {
        escrows[id] = E(depositor, amount, status);
    }
}
