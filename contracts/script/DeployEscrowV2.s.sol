// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VoucherEscrowV2} from "../src/VoucherEscrowV2.sol";

/// @notice Deploys VoucherEscrowV2 on Arc and prints the one owner call that enables USDC.
///
/// The deployer gets no role. OWNER_ADDR (a multisig) must call `setToken` afterwards; until then
/// the contract accepts no deposits, so a half-finished deployment cannot hold funds.
///
/// Dry run (no transaction is sent):
///   forge script script/DeployEscrowV2.s.sol --rpc-url arc_mainnet
/// Real deployment, signed by a keystore account or hardware wallet, never a key in a file:
///   forge script script/DeployEscrowV2.s.sol --rpc-url arc_mainnet --account <keystore-name> --broadcast
contract DeployEscrowV2 is Script {
    uint256 constant ARC_MAINNET = 5042;
    uint256 constant ARC_TESTNET = 5042002;
    /// USDC's ERC-20 address is the same on Arc mainnet and testnet (6 decimals).
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (VoucherEscrowV2 escrow) {
        require(block.chainid == ARC_MAINNET || block.chainid == ARC_TESTNET, "not an Arc network");

        address owner = vm.envAddress("OWNER_ADDR");
        address arbiter = vm.envAddress("ARBITER_ADDR");
        address guardian = vm.envAddress("GUARDIAN_ADDR");
        address treasury = vm.envAddress("TREASURY_ADDR");
        address reserve = vm.envAddress("RESERVE_ADDR");
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(100)));
        uint16 reserveShareBps = uint16(vm.envOr("RESERVE_SHARE_BPS", uint256(5_000)));
        uint32 reviewWindow = uint32(vm.envOr("REVIEW_WINDOW_SECS", uint256(24 hours)));
        uint32 fulfillWindow = uint32(vm.envOr("FULFILL_WINDOW_SECS", uint256(2 hours)));

        if (block.chainid == ARC_MAINNET) {
            // On mainnet the owner must be a contract (a multisig), and no role may share a key with it.
            require(owner.code.length != 0, "OWNER_ADDR must be a multisig on mainnet");
            require(arbiter != owner && guardian != owner, "roles must not reuse the owner");
        }

        vm.startBroadcast();
        escrow = new VoucherEscrowV2(
            owner, arbiter, guardian, treasury, reserve, feeBps, reserveShareBps, reviewWindow, fulfillWindow
        );
        vm.stopBroadcast();

        // Launch limits: 1 to 250 USDC per order, 5,000 USDC locked in total. Raise them only after the audit.
        uint128 minAmount = uint128(vm.envOr("USDC_MIN", uint256(1_000_000)));
        uint128 maxAmount = uint128(vm.envOr("USDC_MAX", uint256(250_000_000)));
        uint256 cap = vm.envOr("USDC_CAP", uint256(5_000_000_000));

        console2.log("VoucherEscrowV2:", address(escrow));
        console2.log("chain id:", block.chainid);
        console2.log("owner:", owner);
        console2.log("Next: the owner must send this call to the escrow to enable USDC:");
        console2.logBytes(abi.encodeCall(VoucherEscrowV2.setToken, (ARC_USDC, true, minAmount, maxAmount, cap)));
    }
}
