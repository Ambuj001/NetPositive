// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {NetPositive} from "../NetPositive.sol";
import {NetPositiveTestBase} from "./NetPositive.t.sol";

contract NetPositiveDisputeTest is NetPositiveTestBase {
    uint256 internal constant FEE = 1e6;
    uint256 internal constant RESERVE = 300_000;
    uint256 internal constant REVENUE = 700_000;

    function _fundReserve() internal {
        bytes32 id = _createDelivered("fund", P);
        vm.prank(buyer);
        np.acceptDelivery(id);
        assertEq(np.disputeReserve(), RESERVE);
    }

    function _assertSolvent() internal view {
        assertEq(usdc.balanceOf(address(np)), _liabilities());
    }

    function _unexpected(NetPositive.State expected, NetPositive.State actual) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(NetPositive.UnexpectedState.selector, expected, actual);
    }

    // ------------------------------------------------------------ openDispute
    function test_OpenDispute_HappyPath() public {
        bytes32 id = _createDelivered("a", P);
        vm.expectEmit(true, false, false, true, address(np));
        emit NetPositive.DisputeOpened(id, uint64(block.timestamp + ARB));
        vm.prank(buyer);
        np.openDispute(id);
        NetPositive.Order memory o = np.getOrder(id);
        assertEq(uint8(o.state), uint8(NetPositive.State.Disputed));
        assertEq(o.disputeDeadline, block.timestamp + ARB);
        assertEq(np.totalEscrowed(), P + FEE); // funds stay escrowed
    }

    function test_OpenDispute_RevertsForNonBuyer() public {
        bytes32 id = _createDelivered("a", P);
        vm.prank(fulfiller);
        vm.expectRevert(NetPositive.Unauthorized.selector);
        np.openDispute(id);
        vm.prank(stranger);
        vm.expectRevert(NetPositive.Unauthorized.selector);
        np.openDispute(id);
        vm.prank(arbitrator);
        vm.expectRevert(NetPositive.Unauthorized.selector);
        np.openDispute(id);
    }

    function test_OpenDispute_BoundaryAndAfterReviewWindow() public {
        bytes32 id = _createDelivered("a", P);
        bytes32 id2 = _createDelivered("b", P);
        uint64 rd = np.getOrder(id).reviewDeadline;
        vm.warp(rd);
        vm.prank(buyer);
        np.openDispute(id); // exactly at the deadline is allowed
        vm.warp(rd + 1);
        vm.prank(buyer);
        vm.expectRevert(NetPositive.DeadlinePassed.selector);
        np.openDispute(id2);
    }

    function test_OpenDispute_RevertsBeforeDeliveryAndTwiceAndAfterRelease() public {
        bytes32 open = _create("o", P);
        vm.prank(buyer);
        vm.expectRevert(_unexpected(NetPositive.State.Delivered, NetPositive.State.Open));
        np.openDispute(open);

        bytes32 d = _createDisputed("d", P);
        vm.prank(buyer);
        vm.expectRevert(_unexpected(NetPositive.State.Delivered, NetPositive.State.Disputed));
        np.openDispute(d);

        bytes32 r = _createDelivered("r", P);
        vm.startPrank(buyer);
        np.acceptDelivery(r);
        vm.expectRevert(_unexpected(NetPositive.State.Delivered, NetPositive.State.Released));
        np.openDispute(r);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ resolveDispute
    function test_Resolve_ForFulfiller() public {
        _fundReserve();
        bytes32 id = _createDisputed("d", P);
        vm.expectEmit(true, false, false, true, address(np));
        emit NetPositive.DisputeResolved(id, true, RESERVE);
        vm.prank(arbitrator);
        np.resolveDispute(id, true);

        assertEq(uint8(_state(id)), uint8(NetPositive.State.ResolvedForFulfiller));
        assertEq(np.withdrawable(fulfiller), 2 * P); // fund order + disputed order
        assertEq(np.withdrawable(revenue), 2 * REVENUE);
        assertEq(np.withdrawable(arbitrator), RESERVE);
        assertEq(np.withdrawable(buyer), 0);
        assertEq(np.disputeReserve(), RESERVE); // +300k earned, -300k paid
        assertEq(np.totalEscrowed(), 0);
        _assertSolvent();
    }

    function test_Resolve_ForBuyerRefundsPrincipalAndFee() public {
        _fundReserve();
        bytes32 id = _createDisputed("d", P);
        vm.expectEmit(true, false, false, true, address(np));
        emit NetPositive.DisputeResolved(id, false, RESERVE);
        vm.prank(arbitrator);
        np.resolveDispute(id, false);

        assertEq(uint8(_state(id)), uint8(NetPositive.State.ResolvedForBuyer));
        assertEq(np.withdrawable(buyer), P + FEE);
        assertEq(np.withdrawable(fulfiller), P); // only from the funded order
        assertEq(np.withdrawable(revenue), REVENUE); // no new revenue
        assertEq(np.withdrawable(arbitrator), RESERVE);
        assertEq(np.disputeReserve(), 0);
        _assertSolvent();
    }

    function test_Resolve_ForBuyerWithEmptyReserveCapsArbitratorPayAtZero() public {
        bytes32 id = _createDisputed("d", P);
        vm.expectEmit(true, false, false, true, address(np));
        emit NetPositive.DisputeResolved(id, false, 0);
        vm.prank(arbitrator);
        np.resolveDispute(id, false);
        assertEq(np.withdrawable(arbitrator), 0);
        assertEq(np.withdrawable(buyer), P + FEE);
        assertEq(np.disputeReserve(), 0);
        _assertSolvent();
    }

    function test_Resolve_ArbitratorPayCappedByReserve() public {
        // small order releases -> reserve = 3_000 (30% of 10_000 fee)
        bytes32 small = _createDelivered("small", 1e6);
        vm.prank(buyer);
        np.acceptDelivery(small);
        assertEq(np.disputeReserve(), 3_000);

        bytes32 id = _createDisputed("big", P); // would want 300_000
        vm.expectEmit(true, false, false, true, address(np));
        emit NetPositive.DisputeResolved(id, false, 3_000);
        vm.prank(arbitrator);
        np.resolveDispute(id, false);
        assertEq(np.withdrawable(arbitrator), 3_000);
        assertEq(np.disputeReserve(), 0);
        _assertSolvent();
    }

    function test_Resolve_ForFulfillerFirstOrderPaysArbitratorFromOwnFee() public {
        bytes32 id = _createDisputed("d", P);
        vm.prank(arbitrator);
        np.resolveDispute(id, true);
        assertEq(np.withdrawable(arbitrator), RESERVE);
        assertEq(np.withdrawable(revenue), REVENUE);
        assertEq(np.disputeReserve(), 0);
        _assertSolvent();
    }

    function test_Resolve_OnlyArbitrator() public {
        bytes32 id = _createDisputed("d", P);
        address[4] memory callers = [buyer, fulfiller, stranger, validator];
        for (uint256 i = 0; i < callers.length; i++) {
            vm.prank(callers[i]);
            vm.expectRevert(NetPositive.Unauthorized.selector);
            np.resolveDispute(id, i % 2 == 0);
        }
        assertEq(uint8(_state(id)), uint8(NetPositive.State.Disputed));
    }

    function test_Resolve_RevertsAfterDisputeDeadlineButAllowsBoundary() public {
        bytes32 id = _createDisputed("d", P);
        bytes32 id2 = _createDisputed("d2", P);
        uint64 dd = np.getOrder(id).disputeDeadline;
        vm.warp(dd);
        vm.prank(arbitrator);
        np.resolveDispute(id, true);
        vm.warp(dd + 1);
        vm.prank(arbitrator);
        vm.expectRevert(NetPositive.DeadlinePassed.selector);
        np.resolveDispute(id2, true);
    }

    function test_Resolve_RevertsWhenNotDisputedOrAlreadyResolved() public {
        bytes32 delivered = _createDelivered("a", P);
        vm.prank(arbitrator);
        vm.expectRevert(_unexpected(NetPositive.State.Disputed, NetPositive.State.Delivered));
        np.resolveDispute(delivered, true);

        bytes32 id = _createDisputed("d", P);
        vm.startPrank(arbitrator);
        np.resolveDispute(id, true);
        vm.expectRevert(_unexpected(NetPositive.State.Disputed, NetPositive.State.ResolvedForFulfiller));
        np.resolveDispute(id, false);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ finalizeUnresolvedDispute
    function test_Fallback_RevertsBeforeAndAtDeadline() public {
        bytes32 id = _createDisputed("d", P);
        vm.expectRevert(NetPositive.DeadlineNotPassed.selector);
        np.finalizeUnresolvedDispute(id);
        vm.warp(np.getOrder(id).disputeDeadline);
        vm.expectRevert(NetPositive.DeadlineNotPassed.selector);
        np.finalizeUnresolvedDispute(id);
    }

    function test_Fallback_EvenPrincipalSplitsAndRefundsFee() public {
        _fundReserve();
        bytes32 id = _createDisputed("d", P);
        vm.warp(np.getOrder(id).disputeDeadline + 1);
        vm.expectEmit(true, false, false, true, address(np));
        emit NetPositive.DisputeFallback(id, P / 2, P / 2 + FEE);
        vm.prank(stranger);
        np.finalizeUnresolvedDispute(id);

        assertEq(uint8(_state(id)), uint8(NetPositive.State.SplitFallback));
        assertEq(np.withdrawable(fulfiller), P + P / 2); // fund order + half
        assertEq(np.withdrawable(buyer), P / 2 + FEE);
        assertEq(np.withdrawable(revenue), REVENUE); // no new revenue
        assertEq(np.withdrawable(arbitrator), 0);
        assertEq(np.disputeReserve(), RESERVE); // untouched
        assertEq(np.totalEscrowed(), 0);
        _assertSolvent();
    }

    function test_Fallback_OddPrincipalRoundsInBuyersFavour() public {
        uint256 p = 1e6 + 1;
        uint256 fee = 10_000;
        bytes32 id = _createDisputed("odd", p);
        vm.warp(np.getOrder(id).disputeDeadline + 1);
        vm.expectEmit(true, false, false, true, address(np));
        emit NetPositive.DisputeFallback(id, 500_000, 500_001 + fee);
        np.finalizeUnresolvedDispute(id);
        assertEq(np.withdrawable(fulfiller), 500_000);
        assertEq(np.withdrawable(buyer), 500_001 + fee);
        _assertSolvent();
    }

    function test_Fallback_RevertsWhenNotDisputedOrAlreadyFinalised() public {
        bytes32 delivered = _createDelivered("a", P);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(_unexpected(NetPositive.State.Disputed, NetPositive.State.Delivered));
        np.finalizeUnresolvedDispute(delivered);

        bytes32 id = _createDisputed("d", P);
        vm.warp(block.timestamp + 5 days);
        np.finalizeUnresolvedDispute(id);
        vm.expectRevert(_unexpected(NetPositive.State.Disputed, NetPositive.State.SplitFallback));
        np.finalizeUnresolvedDispute(id);
    }

    function test_Fallback_RevertsAfterArbitratorResolved() public {
        bytes32 id = _createDisputed("d", P);
        vm.prank(arbitrator);
        np.resolveDispute(id, false);
        vm.warp(block.timestamp + 5 days);
        vm.expectRevert(_unexpected(NetPositive.State.Disputed, NetPositive.State.ResolvedForBuyer));
        np.finalizeUnresolvedDispute(id);
    }

    function test_Fallback_ResolveRevertsAfterFallback() public {
        bytes32 id = _createDisputed("d", P);
        vm.warp(block.timestamp + 5 days);
        np.finalizeUnresolvedDispute(id);
        vm.prank(arbitrator);
        vm.expectRevert(_unexpected(NetPositive.State.Disputed, NetPositive.State.SplitFallback));
        np.resolveDispute(id, true);
    }

    // ------------------------------------------------------------ end-to-end pull payments
    function test_EndToEnd_AllPartiesWithdrawEverything() public {
        _fundReserve();
        bytes32 id = _createDisputed("d", P);
        vm.prank(arbitrator);
        np.resolveDispute(id, false);

        vm.prank(buyer);
        np.withdraw(buyer);
        vm.prank(fulfiller);
        np.withdraw(fulfiller);
        vm.prank(revenue);
        np.withdraw(revenue);
        vm.prank(arbitrator);
        np.withdraw(arbitrator);

        assertEq(np.totalWithdrawable(), 0);
        assertEq(np.totalEscrowed(), 0);
        assertEq(usdc.balanceOf(address(np)), np.disputeReserve());
    }
}
