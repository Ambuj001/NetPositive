// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {NetPositive} from "../NetPositive.sol";
import {NetPositiveTestBase, MockUSDC} from "./NetPositive.t.sol";

contract NetPositiveHandler is Test {
    NetPositive public np;
    MockUSDC public usdc;
    uint256 internal validatorPk;
    address internal arbitrator;
    address internal revenue;
    address internal sink = makeAddr("sink");

    address[] internal buyers;
    address[] internal fulfillers;
    bytes32[] public ids;

    mapping(bytes32 => uint256) internal visitedMask;
    mapping(bytes32 => NetPositive.State) internal lastState;

    bool public violated;
    uint256 public ghostIn;
    uint256 public ghostOut;
    uint256 internal nonce;

    constructor(NetPositive np_, MockUSDC usdc_, uint256 validatorPk_, address arbitrator_, address revenue_) {
        np = np_;
        usdc = usdc_;
        validatorPk = validatorPk_;
        arbitrator = arbitrator_;
        revenue = revenue_;
        for (uint256 i = 0; i < 3; i++) {
            address b = makeAddr(string.concat("hbuyer", vm.toString(i)));
            address f = makeAddr(string.concat("hfulfiller", vm.toString(i)));
            buyers.push(b);
            fulfillers.push(f);
            usdc.mint(b, 1e18);
            vm.prank(b);
            usdc.approve(address(np), type(uint256).max);
        }
    }

    // ---------------------------------------------------------------- views
    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function sumCredits() external view returns (uint256 s) {
        for (uint256 i = 0; i < 3; i++) {
            s += np.withdrawable(buyers[i]) + np.withdrawable(fulfillers[i]);
        }
        s += np.withdrawable(revenue) + np.withdrawable(arbitrator);
    }

    function sumEscrowed() external view returns (uint256 s) {
        for (uint256 i = 0; i < ids.length; i++) {
            NetPositive.Order memory o = np.getOrder(ids[i]);
            if (o.state == NetPositive.State.Open || o.state == NetPositive.State.Delivered || o.state == NetPositive.State.Disputed) {
                s += uint256(o.principal) + o.fee;
            }
        }
    }

    // ---------------------------------------------------------------- tracking
    function _legal(NetPositive.State from, NetPositive.State to) internal pure returns (bool) {
        if (from == NetPositive.State.None) return to == NetPositive.State.Open;
        if (from == NetPositive.State.Open) return to == NetPositive.State.Delivered || to == NetPositive.State.Refunded;
        if (from == NetPositive.State.Delivered) return to == NetPositive.State.Released || to == NetPositive.State.Disputed;
        if (from == NetPositive.State.Disputed) {
            return to == NetPositive.State.ResolvedForBuyer || to == NetPositive.State.ResolvedForFulfiller
                || to == NetPositive.State.SplitFallback;
        }
        return false; // terminal states never change
    }

    function _sync(bytes32 id) internal {
        NetPositive.State s = np.getOrder(id).state;
        NetPositive.State prev = lastState[id];
        if (s == prev) return;
        uint256 bit = 1 << uint256(uint8(s));
        if (visitedMask[id] & bit != 0 || !_legal(prev, s)) violated = true;
        visitedMask[id] |= bit;
        lastState[id] = s;
    }

    function _pick(uint256 seed) internal view returns (bytes32) {
        return ids[seed % ids.length];
    }

    // ---------------------------------------------------------------- actions
    function create(uint256 seed, uint256 principal, uint256 window) external {
        principal = bound(principal, 1e6, 10_000e6);
        window = bound(window, 10 minutes, 7 days);
        address b = buyers[seed % 3];
        address f = fulfillers[(seed / 3) % 3];
        bytes32 salt = bytes32(++nonce);
        bytes32 id = np.computeTradeId(b, salt);
        vm.prank(b);
        try np.createOrder(salt, f, principal, uint64(block.timestamp + window), keccak256(abi.encode(salt))) {
            ids.push(id);
            ghostIn += principal + np.feeFor(principal);
            _sync(id);
        } catch {
            violated = true; // inputs are always valid
        }
    }

    function deliver(uint256 seed) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        NetPositive.Order memory o = np.getOrder(id);
        uint64 exp = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sig(validatorPk, id, o.buyerRecipient, exp);
        vm.prank(o.fulfiller);
        try np.submitDelivery(id, keccak256("d"), exp, sig) {} catch {}
        _sync(id);
    }

    function deliverBadSignature(uint256 seed) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        NetPositive.Order memory o = np.getOrder(id);
        uint64 exp = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sig(validatorPk + 1, id, o.buyerRecipient, exp);
        vm.prank(o.fulfiller);
        try np.submitDelivery(id, keccak256("d"), exp, sig) {
            violated = true; // forged attestation must never be accepted
        } catch {}
    }

    function accept(uint256 seed) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        address b = np.getOrder(id).buyer;
        vm.prank(b);
        try np.acceptDelivery(id) {} catch {}
        _sync(id);
    }

    function releaseAfterReview(uint256 seed) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        try np.releaseAfterReview(id) {} catch {}
        _sync(id);
    }

    function refund(uint256 seed) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        try np.refundExpired(id) {} catch {}
        _sync(id);
    }

    function dispute(uint256 seed) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        address b = np.getOrder(id).buyer;
        vm.prank(b);
        try np.openDispute(id) {} catch {}
        _sync(id);
    }

    function resolve(uint256 seed, bool payFulfiller) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        vm.prank(arbitrator);
        try np.resolveDispute(id, payFulfiller) {} catch {}
        _sync(id);
    }

    function fallbackFinalize(uint256 seed) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        try np.finalizeUnresolvedDispute(id) {} catch {}
        _sync(id);
    }

    function withdraw(uint256 seed) external {
        address who;
        uint256 k = seed % 8;
        if (k < 3) who = buyers[k];
        else if (k < 6) who = fulfillers[k - 3];
        else if (k == 6) who = revenue;
        else who = arbitrator;
        vm.prank(who);
        try np.withdraw(sink) returns (uint256 amt) {
            ghostOut += amt;
        } catch {}
    }

    function donate(uint256 amt) external {
        amt = bound(amt, 0, 1_000e6);
        usdc.mint(address(np), amt);
        ghostIn += amt;
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 4 days));
    }

    function _sig(uint256 pk, bytes32 id, bytes32 recip, uint64 exp) internal view returns (bytes memory) {
        bytes32 d = np.hashDeliveryAttestation(id, keccak256("d"), recip, exp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }
}

contract NetPositiveInvariantTest is NetPositiveTestBase {
    NetPositiveHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new NetPositiveHandler(np, usdc, validatorPk, arbitrator, revenue);
        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](11);
        sels[0] = NetPositiveHandler.create.selector;
        sels[1] = NetPositiveHandler.deliver.selector;
        sels[2] = NetPositiveHandler.deliverBadSignature.selector;
        sels[3] = NetPositiveHandler.accept.selector;
        sels[4] = NetPositiveHandler.releaseAfterReview.selector;
        sels[5] = NetPositiveHandler.refund.selector;
        sels[6] = NetPositiveHandler.dispute.selector;
        sels[7] = NetPositiveHandler.resolve.selector;
        sels[8] = NetPositiveHandler.fallbackFinalize.selector;
        sels[9] = NetPositiveHandler.withdraw.selector;
        sels[10] = NetPositiveHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    /// Sanity: the handler can actually drive an order to terminal states (non-vacuous invariants).
    function test_HandlerDrivesOrdersToTerminalStates() public {
        handler.create(0, 100e6, 1 days);
        handler.deliver(0);
        handler.accept(0);
        assertEq(uint8(np.getOrder(handler.ids(0)).state), uint8(NetPositive.State.Released));
        handler.create(1, 100e6, 1 days);
        handler.deliver(1);
        handler.dispute(1);
        handler.resolve(1, false);
        assertEq(uint8(np.getOrder(handler.ids(1)).state), uint8(NetPositive.State.ResolvedForBuyer));
        handler.deliverBadSignature(0);
        handler.withdraw(7);
        assertFalse(handler.violated());
        assertGt(handler.ghostOut(), 0);
        assertEq(np.totalWithdrawable(), handler.sumCredits());
    }

    /// USDC.balanceOf(this) >= totalEscrowed + totalWithdrawable + disputeReserve
    function invariant_BalanceCoversLiabilities() public view {
        (uint256 bal, uint256 liab) = np.solvency();
        assertGe(bal, liab);
        assertGe(usdc.balanceOf(address(np)), np.totalEscrowed() + np.totalWithdrawable() + np.disputeReserve());
    }

    /// With no donations the balance equals exactly what flowed in minus what flowed out.
    function invariant_BalanceMatchesGhostFlows() public view {
        assertEq(usdc.balanceOf(address(np)), handler.ghostIn() - handler.ghostOut());
    }

    /// No order ever returns to a state it already left, and only legal transitions occur.
    function invariant_NoStateReturnsToPreviousState() public view {
        assertFalse(handler.violated());
    }

    function invariant_TotalWithdrawableEqualsSumOfCredits() public view {
        assertEq(np.totalWithdrawable(), handler.sumCredits());
    }

    function invariant_TotalEscrowedEqualsLiveOrders() public view {
        assertEq(np.totalEscrowed(), handler.sumEscrowed());
    }
}
