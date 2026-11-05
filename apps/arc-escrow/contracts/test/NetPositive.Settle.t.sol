// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {NetPositive} from "../NetPositive.sol";
import {NetPositiveTestBase} from "./NetPositive.t.sol";

contract NetPositiveSettleTest is NetPositiveTestBase {
    uint256 internal constant FEE = 1e6;
    uint256 internal constant RESERVE = 300_000;
    uint256 internal constant REVENUE = 700_000;

    // ------------------------------------------------------------ acceptDelivery
    function test_Accept_ReleasesFullPrincipalAndSplitsFee() public {
        bytes32 id = _createDelivered("a", P);
        vm.expectEmit(true, false, false, false, address(np));
        emit NetPositive.OrderReleased(id);
        vm.prank(buyer);
        np.acceptDelivery(id);

        assertEq(uint8(_state(id)), uint8(NetPositive.State.Released));
        assertEq(np.withdrawable(fulfiller), P);
        assertEq(np.withdrawable(revenue), REVENUE);
        assertEq(np.disputeReserve(), RESERVE);
        assertEq(np.totalEscrowed(), 0);
        assertEq(np.totalWithdrawable(), P + REVENUE);
        assertEq(usdc.balanceOf(address(np)), P + FEE);
        assertEq(usdc.balanceOf(address(np)), _liabilities());
    }

    function test_Accept_RevertsForNonBuyer() public {
        bytes32 id = _createDelivered("a", P);
        vm.prank(stranger);
        vm.expectRevert(NetPositive.Unauthorized.selector);
        np.acceptDelivery(id);
        vm.prank(fulfiller);
        vm.expectRevert(NetPositive.Unauthorized.selector);
        np.acceptDelivery(id);
    }

    function test_Accept_RevertsBeforeDelivery() public {
        bytes32 id = _create("a", P);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(NetPositive.UnexpectedState.selector, NetPositive.State.Delivered, NetPositive.State.Open));
        np.acceptDelivery(id);
    }

    function test_Accept_RevertsTwice() public {
        bytes32 id = _createDelivered("a", P);
        vm.startPrank(buyer);
        np.acceptDelivery(id);
        vm.expectRevert(abi.encodeWithSelector(NetPositive.UnexpectedState.selector, NetPositive.State.Delivered, NetPositive.State.Released));
        np.acceptDelivery(id);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ releaseAfterReview
    function test_ReleaseAfterReview_RevertsBeforeAndAtDeadline() public {
        bytes32 id = _createDelivered("a", P);
        uint64 rd = np.getOrder(id).reviewDeadline;
        vm.expectRevert(NetPositive.DeadlineNotPassed.selector);
        np.releaseAfterReview(id);
        vm.warp(rd);
        vm.expectRevert(NetPositive.DeadlineNotPassed.selector);
        np.releaseAfterReview(id);
    }

    function test_ReleaseAfterReview_PermissionlessAfterDeadline() public {
        bytes32 id = _createDelivered("a", P);
        vm.warp(np.getOrder(id).reviewDeadline + 1);
        vm.expectEmit(true, false, false, false, address(np));
        emit NetPositive.OrderReleased(id);
        vm.prank(stranger);
        np.releaseAfterReview(id);
        assertEq(uint8(_state(id)), uint8(NetPositive.State.Released));
        assertEq(np.withdrawable(fulfiller), P);
        assertEq(np.withdrawable(revenue), REVENUE);
        assertEq(np.disputeReserve(), RESERVE);
    }

    function test_ReleaseAfterReview_RevertsIfNotDelivered() public {
        bytes32 id = _create("a", P);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(abi.encodeWithSelector(NetPositive.UnexpectedState.selector, NetPositive.State.Delivered, NetPositive.State.Open));
        np.releaseAfterReview(id);
    }

    function test_ReleaseAfterReview_RevertsAfterAccept() public {
        bytes32 id = _createDelivered("a", P);
        vm.prank(buyer);
        np.acceptDelivery(id);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(abi.encodeWithSelector(NetPositive.UnexpectedState.selector, NetPositive.State.Delivered, NetPositive.State.Released));
        np.releaseAfterReview(id);
    }

    function test_ReleaseAfterReview_RevertsOnDisputedOrder() public {
        bytes32 id = _createDisputed("a", P);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(abi.encodeWithSelector(NetPositive.UnexpectedState.selector, NetPositive.State.Delivered, NetPositive.State.Disputed));
        np.releaseAfterReview(id);
    }

    // ------------------------------------------------------------ refundExpired
    function test_Refund_RevertsBeforeAndAtDeadline() public {
        bytes32 id = _create("a", P);
        uint64 dl = np.getOrder(id).deliveryDeadline;
        vm.expectRevert(NetPositive.DeadlineNotPassed.selector);
        np.refundExpired(id);
        vm.warp(dl);
        vm.expectRevert(NetPositive.DeadlineNotPassed.selector);
        np.refundExpired(id);
    }

    function test_Refund_PermissionlessAfterDeadlineCreditsBuyerFully() public {
        bytes32 id = _create("a", P);
        vm.warp(np.getOrder(id).deliveryDeadline + 1);
        vm.expectEmit(true, false, false, false, address(np));
        emit NetPositive.OrderRefunded(id);
        vm.prank(stranger);
        np.refundExpired(id);
        assertEq(uint8(_state(id)), uint8(NetPositive.State.Refunded));
        assertEq(np.withdrawable(buyer), P + FEE);
        assertEq(np.totalEscrowed(), 0);
        assertEq(np.disputeReserve(), 0);
        assertEq(np.withdrawable(revenue), 0);
        assertEq(usdc.balanceOf(address(np)), _liabilities());
    }

    function test_Refund_RevertsAfterDelivery() public {
        bytes32 id = _createDelivered("a", P);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(abi.encodeWithSelector(NetPositive.UnexpectedState.selector, NetPositive.State.Open, NetPositive.State.Delivered));
        np.refundExpired(id);
    }

    function test_Refund_RevertsTwice() public {
        bytes32 id = _create("a", P);
        vm.warp(np.getOrder(id).deliveryDeadline + 1);
        np.refundExpired(id);
        vm.expectRevert(abi.encodeWithSelector(NetPositive.UnexpectedState.selector, NetPositive.State.Open, NetPositive.State.Refunded));
        np.refundExpired(id);
    }

    function test_Refund_BlocksLateDelivery() public {
        bytes32 id = _create("a", P);
        uint64 exp = uint64(block.timestamp + 3 days);
        bytes memory sig = _sign(validatorPk, id, DIGEST, RECIP, exp);
        vm.warp(np.getOrder(id).deliveryDeadline + 1);
        np.refundExpired(id);
        vm.prank(fulfiller);
        vm.expectRevert(abi.encodeWithSelector(NetPositive.UnexpectedState.selector, NetPositive.State.Open, NetPositive.State.Refunded));
        np.submitDelivery(id, DIGEST, exp, sig);
    }

    // ------------------------------------------------------------ withdraw
    function _released() internal returns (bytes32 id) {
        id = _createDelivered("a", P);
        vm.prank(buyer);
        np.acceptDelivery(id);
    }

    function test_Withdraw_ToSelfPaysAndZeroesCredit() public {
        _released();
        vm.expectEmit(true, true, false, true, address(np));
        emit NetPositive.Withdrawn(fulfiller, fulfiller, P);
        vm.prank(fulfiller);
        uint256 amt = np.withdraw(fulfiller);
        assertEq(amt, P);
        assertEq(usdc.balanceOf(fulfiller), P);
        assertEq(np.withdrawable(fulfiller), 0);
        assertEq(np.totalWithdrawable(), REVENUE);
    }

    function test_Withdraw_ToOtherAddress() public {
        _released();
        vm.expectEmit(true, true, false, true, address(np));
        emit NetPositive.Withdrawn(revenue, other, REVENUE);
        vm.prank(revenue);
        np.withdraw(other);
        assertEq(usdc.balanceOf(other), REVENUE);
        assertEq(usdc.balanceOf(revenue), 0);
    }

    function test_Withdraw_RevertsZeroBalance() public {
        vm.prank(stranger);
        vm.expectRevert(NetPositive.NothingToWithdraw.selector);
        np.withdraw(stranger);
    }

    function test_Withdraw_RevertsSecondTime() public {
        _released();
        vm.startPrank(fulfiller);
        np.withdraw(fulfiller);
        vm.expectRevert(NetPositive.NothingToWithdraw.selector);
        np.withdraw(fulfiller);
        vm.stopPrank();
    }

    function test_Withdraw_RevertsInvalidDestination() public {
        _released();
        vm.startPrank(fulfiller);
        vm.expectRevert(NetPositive.InvalidAddress.selector);
        np.withdraw(address(0));
        vm.expectRevert(NetPositive.InvalidAddress.selector);
        np.withdraw(address(np));
        vm.stopPrank();
        assertEq(np.withdrawable(fulfiller), P);
    }

    function test_Withdraw_CannotTakeAnotherAccountsCredit() public {
        _released();
        vm.prank(stranger);
        vm.expectRevert(NetPositive.NothingToWithdraw.selector);
        np.withdraw(stranger);
        assertEq(np.withdrawable(fulfiller), P);
    }

    function test_Withdraw_BlockedDestinationRevertsButPreservesCredit() public {
        _released();
        usdc.setBlocked(other, true);
        vm.prank(fulfiller);
        vm.expectRevert();
        np.withdraw(other);
        assertEq(np.withdrawable(fulfiller), P);
        assertEq(np.totalWithdrawable(), P + REVENUE);
        // can redirect to an unblocked address
        vm.prank(fulfiller);
        np.withdraw(stranger);
        assertEq(usdc.balanceOf(stranger), P);
    }

    function test_BlockedRecipientDoesNotStopOthersOrSettlement() public {
        bytes32 id1 = _createDelivered("a", P);
        vm.prank(buyer);
        np.acceptDelivery(id1);
        // revenue recipient (credited on every release) and fulfiller are blocked
        usdc.setBlocked(revenue, true);
        usdc.setBlocked(fulfiller, true);

        // settlement of a new order still works
        bytes32 id2 = _createDelivered("b", P);
        vm.prank(buyer);
        np.acceptDelivery(id2);
        assertEq(np.withdrawable(revenue), 2 * REVENUE);

        // blocked accounts cannot withdraw to themselves ...
        vm.prank(revenue);
        vm.expectRevert();
        np.withdraw(revenue);
        // ... another account's withdrawal is unaffected ...
        vm.prank(buyer);
        vm.expectRevert(NetPositive.NothingToWithdraw.selector); // buyer has no credit, but is not blocked by others
        np.withdraw(buyer);
        // ... blocked accounts can redirect elsewhere
        vm.prank(revenue);
        np.withdraw(other);
        assertEq(usdc.balanceOf(other), 2 * REVENUE);
        vm.prank(fulfiller);
        np.withdraw(stranger);
        assertEq(usdc.balanceOf(stranger), 2 * P);
        assertEq(usdc.balanceOf(address(np)), _liabilities());
    }

    function test_BlockedArbitratorDoesNotStopResolution() public {
        _released(); // fund reserve
        usdc.setBlocked(arbitrator, true);
        bytes32 id = _createDisputed("d", P);
        vm.prank(arbitrator);
        np.resolveDispute(id, false);
        assertEq(uint8(_state(id)), uint8(NetPositive.State.ResolvedForBuyer));
        assertEq(np.withdrawable(arbitrator), RESERVE);
        vm.prank(arbitrator);
        vm.expectRevert();
        np.withdraw(arbitrator);
        vm.prank(arbitrator);
        np.withdraw(other);
        assertEq(usdc.balanceOf(other), RESERVE);
    }

    function test_Solvency_ViewReportsBalanceAndLiabilities() public {
        _released();
        (uint256 bal, uint256 liab) = np.solvency();
        assertEq(bal, P + FEE);
        assertEq(liab, P + FEE);
    }

    function test_DonationDoesNotBecomeLiabilityOrWithdrawable() public {
        _released();
        usdc.mint(address(np), 5e6);
        (uint256 bal, uint256 liab) = np.solvency();
        assertEq(bal, liab + 5e6);
        vm.prank(stranger);
        vm.expectRevert(NetPositive.NothingToWithdraw.selector);
        np.withdraw(stranger);
    }
}
