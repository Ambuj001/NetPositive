// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {NetPositive} from "../NetPositive.sol";
import {NetPositiveTestBase} from "./NetPositive.t.sol";

contract NetPositiveFuzzTest is NetPositiveTestBase {
    uint256 internal constant MIN_P = 1e6;
    uint256 internal constant MAX_P = 10_000e6;

    function _credits() internal view returns (uint256) {
        return np.withdrawable(buyer) + np.withdrawable(fulfiller) + np.withdrawable(revenue)
            + np.withdrawable(arbitrator) + np.withdrawable(stranger);
    }

    function testFuzz_FeeMath(uint256 principal) public view {
        principal = bound(principal, MIN_P, MAX_P);
        uint256 fee = np.feeFor(principal);
        assertEq(fee, principal / 100);
        uint256 reserve = np.reserveShareOf(fee);
        assertEq(reserve, fee * 3 / 10);
        assertLe(reserve, fee);
        assertEq(reserve + (fee - reserve), fee);
        // reserve share is 30% rounded down => revenue share is 70% rounded up
        assertGe(fee - reserve, fee * 7 / 10);
    }

    function testFuzz_Conservation_AllTerminalPaths(uint256 principal, uint8 pathSeed) public {
        principal = bound(principal, MIN_P, MAX_P);
        uint8 path = pathSeed % 6;
        uint256 fee = principal / 100;
        uint256 reserve = fee * 3 / 10;
        uint256 buyerStart = usdc.balanceOf(buyer);

        bytes32 id;
        if (path == 2) {
            id = _create("f", principal);
            vm.warp(np.getOrder(id).deliveryDeadline + 1);
            vm.prank(stranger);
            np.refundExpired(id);
            assertEq(np.withdrawable(buyer), principal + fee);
            assertEq(np.disputeReserve(), 0);
        } else if (path == 0 || path == 1) {
            id = _createDelivered("f", principal);
            if (path == 0) {
                vm.prank(buyer);
                np.acceptDelivery(id);
            } else {
                vm.warp(np.getOrder(id).reviewDeadline + 1);
                vm.prank(stranger);
                np.releaseAfterReview(id);
            }
            assertEq(np.withdrawable(fulfiller), principal);
            assertEq(np.withdrawable(revenue), fee - reserve);
            assertEq(np.disputeReserve(), reserve);
        } else {
            id = _createDisputed("f", principal);
            if (path == 5) {
                vm.warp(np.getOrder(id).disputeDeadline + 1);
                vm.prank(stranger);
                np.finalizeUnresolvedDispute(id);
                assertEq(np.withdrawable(fulfiller), principal / 2);
                assertEq(np.withdrawable(buyer), principal - principal / 2 + fee);
                assertEq(np.disputeReserve(), 0);
            } else if (path == 3) {
                vm.prank(arbitrator);
                np.resolveDispute(id, true);
                assertEq(np.withdrawable(fulfiller), principal);
                assertEq(np.withdrawable(revenue), fee - reserve);
                assertEq(np.withdrawable(arbitrator), reserve);
                assertEq(np.disputeReserve(), 0);
            } else {
                vm.prank(arbitrator);
                np.resolveDispute(id, false);
                assertEq(np.withdrawable(buyer), principal + fee);
                assertEq(np.withdrawable(arbitrator), 0);
                assertEq(np.disputeReserve(), 0);
            }
        }

        // every deposited USDC is accounted for: credits + reserve == deposit
        assertEq(_credits() + np.disputeReserve(), principal + fee);
        assertEq(np.totalWithdrawable() + np.disputeReserve(), principal + fee);
        assertEq(np.totalEscrowed(), 0);
        assertEq(usdc.balanceOf(address(np)), principal + fee);
        assertEq(buyerStart - usdc.balanceOf(buyer), principal + fee);
        assertGt(uint8(_state(id)), uint8(NetPositive.State.Disputed));
    }

    function testFuzz_Conservation_TwoOrdersArbitratorPayCapped(uint256 p1, uint256 p2, bool payFulfiller) public {
        p1 = bound(p1, MIN_P, MAX_P);
        p2 = bound(p2, MIN_P, MAX_P);
        bytes32 a = _createDelivered("a", p1);
        vm.prank(buyer);
        np.acceptDelivery(a);
        uint256 reserve1 = (p1 / 100) * 3 / 10;
        assertEq(np.disputeReserve(), reserve1);

        bytes32 b = _createDisputed("b", p2);
        uint256 fee2 = p2 / 100;
        uint256 share2 = fee2 * 3 / 10;
        uint256 available = payFulfiller ? reserve1 + share2 : reserve1;
        uint256 expectedPay = share2 < available ? share2 : available;
        vm.prank(arbitrator);
        np.resolveDispute(b, payFulfiller);

        assertEq(np.withdrawable(arbitrator), expectedPay);
        assertEq(np.disputeReserve(), available - expectedPay);
        assertEq(np.totalEscrowed(), 0);
        assertEq(usdc.balanceOf(address(np)), np.totalWithdrawable() + np.disputeReserve());
        assertEq(usdc.balanceOf(address(np)), p1 + p1 / 100 + p2 + fee2);
    }

    function testFuzz_Submit_RejectsAnyNonValidatorKey(uint256 pk) public {
        pk = bound(pk, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        vm.assume(pk != validatorPk);
        bytes32 id = _create("s", P);
        uint64 exp = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(pk, id, DIGEST, RECIP, exp);
        vm.prank(fulfiller);
        vm.expectRevert(NetPositive.InvalidAttestation.selector);
        np.submitDelivery(id, DIGEST, exp, sig);
    }

    function testFuzz_Submit_DeliveryTimingWindow(uint256 dt) public {
        bytes32 id = _create("s", P);
        uint64 dl = np.getOrder(id).deliveryDeadline;
        uint64 exp = dl + 30 days;
        bytes memory sig = _sign(validatorPk, id, DIGEST, RECIP, exp);
        dt = bound(dt, 0, 2 days);
        vm.warp(block.timestamp + dt);
        vm.prank(fulfiller);
        if (block.timestamp > dl) {
            vm.expectRevert(NetPositive.DeadlinePassed.selector);
        }
        np.submitDelivery(id, DIGEST, exp, sig);
    }

    function testFuzz_Withdraw_PaysExactCreditToAnyDestination(address to, uint256 principal) public {
        vm.assume(to != address(0) && to != address(np) && to != USDC_ADDR);
        principal = bound(principal, MIN_P, MAX_P);
        bytes32 id = _createDelivered("w", principal);
        vm.prank(buyer);
        np.acceptDelivery(id);
        uint256 before = usdc.balanceOf(to);
        vm.prank(fulfiller);
        uint256 amt = np.withdraw(to);
        assertEq(amt, principal);
        assertEq(usdc.balanceOf(to) - before, principal);
        assertEq(np.withdrawable(fulfiller), 0);
    }
}
