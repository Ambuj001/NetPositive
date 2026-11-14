// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VoucherEscrowV2} from "../src/VoucherEscrowV2.sol";
import {MockUSDC} from "./mocks/Mocks.sol";

/// @dev Drives the escrow with random calls from depositors, fulfillers, the arbiter and strangers.
contract Handler is Test {
    VoucherEscrowV2 public immutable escrow;
    MockUSDC public immutable usdc;
    address public immutable arbiter;

    address[] public actors;
    bytes32[] public ids;
    uint256 public nonce;

    uint256 public totalIn; // pulled from depositors
    uint256 public settledCalls;

    constructor(VoucherEscrowV2 escrow_, MockUSDC usdc_, address arbiter_) {
        escrow = escrow_;
        usdc = usdc_;
        arbiter = arbiter_;
        for (uint256 i = 0; i < 4; i++) {
            address a = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(a);
            usdc.mint(a, 1e15);
            vm.prank(a);
            usdc.approve(address(escrow), type(uint256).max);
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % actors.length];
    }

    function _id(uint256 seed) private view returns (bytes32) {
        return ids.length == 0 ? bytes32(0) : ids[seed % ids.length];
    }

    function deposit(uint256 actorSeed, uint256 amount, uint64 ttl) external {
        address a = _actor(actorSeed);
        amount = bound(amount, 1_000_000, 5_000_000_000);
        ttl = uint64(bound(ttl, 1 hours, 30 days));
        uint256 balBefore = usdc.balanceOf(a);
        vm.prank(a);
        try escrow.deposit(bytes32(nonce++), address(usdc), amount, ttl, type(uint256).max) returns (bytes32 id) {
            ids.push(id);
            totalIn += balBefore - usdc.balanceOf(a);
        } catch {}
    }

    function assign(uint256 idSeed, uint256 actorSeed) external {
        bytes32 id = _id(idSeed);
        vm.prank(escrow.getEscrow(id).depositor);
        try escrow.assign(id, _actor(actorSeed)) {} catch {}
    }

    function unassign(uint256 idSeed) external {
        bytes32 id = _id(idSeed);
        vm.prank(escrow.getEscrow(id).fulfiller);
        try escrow.unassign(id) {} catch {}
    }

    function markDelivered(uint256 idSeed) external {
        bytes32 id = _id(idSeed);
        vm.prank(escrow.getEscrow(id).fulfiller);
        try escrow.markDelivered(id, bytes32(idSeed)) {} catch {}
    }

    function release(uint256 idSeed) external {
        bytes32 id = _id(idSeed);
        vm.prank(escrow.getEscrow(id).depositor);
        try escrow.release(id) {
            settledCalls++;
        } catch {}
    }

    function cancel(uint256 idSeed) external {
        bytes32 id = _id(idSeed);
        vm.prank(escrow.getEscrow(id).depositor);
        try escrow.cancel(id) {
            settledCalls++;
        } catch {}
    }

    function dispute(uint256 idSeed) external {
        bytes32 id = _id(idSeed);
        vm.prank(escrow.getEscrow(id).depositor);
        try escrow.dispute(id, bytes32(idSeed)) {} catch {}
    }

    function concede(uint256 idSeed) external {
        bytes32 id = _id(idSeed);
        vm.prank(escrow.getEscrow(id).fulfiller);
        try escrow.concede(id) {
            settledCalls++;
        } catch {}
    }

    function resolve(uint256 idSeed, uint256 toFulfiller) external {
        bytes32 id = _id(idSeed);
        toFulfiller = bound(toFulfiller, 0, escrow.getEscrow(id).amount);
        vm.prank(arbiter);
        try escrow.resolve(id, toFulfiller) {
            settledCalls++;
        } catch {}
    }

    function permissionless(uint256 idSeed, uint8 which) external {
        bytes32 id = _id(idSeed);
        if (which % 3 == 0) {
            try escrow.claim(id) {
                settledCalls++;
            } catch {}
        } else if (which % 3 == 1) {
            try escrow.refundExpired(id) {
                settledCalls++;
            } catch {}
        } else {
            try escrow.refundStaleDispute(id) {
                settledCalls++;
            } catch {}
        }
    }

    function withdrawFees() external {
        try escrow.withdrawFees(address(usdc)) {} catch {}
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 3 days));
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }
}

contract VoucherEscrowV2InvariantTest is Test {
    VoucherEscrowV2 escrow;
    MockUSDC usdc;
    Handler handler;

    address owner = makeAddr("owner");
    address arbiter = makeAddr("arbiter");
    address treasury = makeAddr("treasury");
    address reserve = makeAddr("reserve");

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new VoucherEscrowV2(owner, arbiter, makeAddr("guardian"), treasury, reserve, 100, 5_000, 1 hours, 2 hours);
        vm.prank(owner);
        escrow.setToken(address(usdc), true, 1_000_000, 10_000_000_000, type(uint256).max, 750_000);
        handler = new Handler(escrow, usdc, arbiter);
        targetContract(address(handler));
    }

    /// The contract holds exactly what it owes to live escrows plus unwithdrawn fees.
    function invariant_balanceEqualsLockedPlusFees() public view {
        assertEq(usdc.balanceOf(address(escrow)), escrow.totalLocked(address(usdc)) + escrow.accruedFees(address(usdc)));
    }

    /// totalLocked is the sum of amount + fee over escrows that have not ended.
    function invariant_totalLockedMatchesLiveEscrows() public view {
        uint256 sum;
        uint256 n = handler.idCount();
        for (uint256 i = 0; i < n; i++) {
            VoucherEscrowV2.Escrow memory e = escrow.getEscrow(handler.ids(i));
            if (e.status == VoucherEscrowV2.Status.Funded || e.status == VoucherEscrowV2.Status.Delivered) {
                sum += uint256(e.amount) + e.fee;
            } else if (e.status == VoucherEscrowV2.Status.Disputed) {
                sum += uint256(e.amount) + e.fee + e.bond; // the stake is held only while disputed
            }
        }
        assertEq(sum, escrow.totalLocked(address(usdc)));
    }

    /// Money only moves between the actors, the escrow and the two fee recipients. Nothing leaks elsewhere.
    function invariant_noValueLeaves() public view {
        uint256 held = usdc.balanceOf(address(escrow)) + usdc.balanceOf(treasury) + usdc.balanceOf(reserve);
        uint256 n = handler.actorCount();
        for (uint256 i = 0; i < n; i++) {
            held += usdc.balanceOf(handler.actors(i));
        }
        assertEq(held, n * 1e15);
    }
}
