// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {NetPositive} from "../NetPositive.sol";
import {MockUSDC} from "./NetPositive.t.sol";

/// @notice Pins the EIP-712 digest that the TypeScript backend signs (src/shared/attestation.ts) to the
/// digest this contract verifies. If either side changes its domain or struct, one of the two tests fails.
contract NetPositiveTsParityTest is Test {
    // Produced by `bun test src/shared/envelope.test.ts` for the inputs below.
    bytes32 internal constant TS_DIGEST = 0xb3493bf794e4d5b764cc93e080a27dab3436c85037e1e2a83089b184f92d1f5a;

    function test_AttestationDigestMatchesTypeScript() public {
        address usdcAddr = 0x3600000000000000000000000000000000000000;
        vm.etch(usdcAddr, address(new MockUSDC()).code);
        address target = address(uint160(0xBEEF1));
        vm.chainId(5042002);
        deployCodeTo(
            "NetPositive.sol:NetPositive",
            abi.encode(makeAddr("validator"), makeAddr("arbitrator"), makeAddr("revenue"), uint64(1 hours), uint64(1 days)),
            target
        );
        bytes32 digest = NetPositive(target).hashDeliveryAttestation(
            bytes32(hex"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            bytes32(hex"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
            bytes32(hex"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"),
            1_900_000_000
        );
        emit log_bytes32(digest);
        assertEq(digest, TS_DIGEST);
    }
}
