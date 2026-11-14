// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {VoucherEscrowV2} from "../src/VoucherEscrowV2.sol";
import {MockUSDC, FeeOnTransferToken, MockWallet} from "./mocks/Mocks.sol";

contract VoucherEscrowV2Test is Test {
    VoucherEscrowV2 escrow;
    MockUSDC usdc;

    address owner = makeAddr("owner");
    address arbiter = makeAddr("arbiter");
    address guardian = makeAddr("guardian");
    address treasury = makeAddr("treasury");
    address reserve = makeAddr("reserve");
    address fulfiller = makeAddr("fulfiller");
    address stranger = makeAddr("stranger");
    address depositor;
    uint256 depositorKey;

    uint16 constant FEE_BPS = 100; // 1%
    uint16 constant RESERVE_SHARE_BPS = 5_000; // half of the fee
    uint32 constant REVIEW = 1 hours;
    uint32 constant FULFILL = 2 hours;
    uint64 constant TTL = 1 days;
    uint256 constant AMOUNT = 111_110_000; // 111.11 USDC
    uint256 constant FEE = 1_111_100; // 1% of AMOUNT
    bytes32 constant REF = keccak256("order-1");

    event Settled(
        bytes32 indexed id, VoucherEscrowV2.Status status, uint256 toFulfiller, uint256 toDepositor, uint256 feeKept
    );

    function setUp() public {
        (depositor, depositorKey) = makeAddrAndKey("depositor");
        usdc = new MockUSDC();
        escrow = new VoucherEscrowV2(
            owner, arbiter, guardian, treasury, reserve, FEE_BPS, RESERVE_SHARE_BPS, REVIEW, FULFILL
        );
        vm.prank(owner);
        escrow.setToken(address(usdc), true, 1_000_000, 10_000_000_000, 100_000_000_000);
        usdc.mint(depositor, 1_000_000_000_000);
        vm.prank(depositor);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ─────────────────────────── helpers ───────────────────────────

    function _deposit() internal returns (bytes32 id) {
        vm.prank(depositor);
        id = escrow.deposit(REF, address(usdc), AMOUNT, TTL, AMOUNT + FEE);
    }

    function _assigned() internal returns (bytes32 id) {
        id = _deposit();
        vm.prank(depositor);
        escrow.assign(id, fulfiller);
    }

    function _delivered() internal returns (bytes32 id) {
        id = _assigned();
        vm.prank(fulfiller);
        escrow.markDelivered(id, keccak256("ciphertext"));
    }

    function _disputed() internal returns (bytes32 id) {
        id = _delivered();
        vm.prank(depositor);
        escrow.dispute(id, keccak256("voucher already used"));
    }

    function _status(bytes32 id) internal view returns (VoucherEscrowV2.Status) {
        return escrow.getEscrow(id).status;
    }

    function _signAssign(uint256 key, bytes32 id, address who, uint64 validUntil) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, escrow.assignDigest(id, who, validUntil));
        return abi.encodePacked(r, s, v);
    }

    /// The contract always holds exactly what it owes.
    function _assertSolvent() internal view {
        assertEq(
            usdc.balanceOf(address(escrow)),
            escrow.totalLocked(address(usdc)) + escrow.accruedFees(address(usdc)),
            "balance != locked + fees"
        );
    }

    // ─────────────────────────── deposit ───────────────────────────

    function test_deposit_locksAmountPlusFee() public {
        uint256 before = usdc.balanceOf(depositor);
        bytes32 id = _deposit();

        assertEq(id, escrow.escrowId(depositor, REF));
        assertEq(before - usdc.balanceOf(depositor), AMOUNT + FEE);
        assertEq(escrow.totalLocked(address(usdc)), AMOUNT + FEE);

        VoucherEscrowV2.Escrow memory e = escrow.getEscrow(id);
        assertEq(e.depositor, depositor);
        assertEq(e.fulfiller, address(0));
        assertEq(e.amount, AMOUNT);
        assertEq(e.fee, FEE);
        assertEq(e.openUntil, block.timestamp + TTL);
        assertEq(uint8(e.status), uint8(VoucherEscrowV2.Status.Funded));

        // V1-shaped view used by CodeMailbox: status 1 means funded.
        (address d, uint256 a, uint8 s) = escrow.escrows(id);
        assertEq(d, depositor);
        assertEq(a, AMOUNT);
        assertEq(s, 1);
        _assertSolvent();
    }

    function test_deposit_idCannotBeSquatted() public {
        // A stranger using the same ref gets a different id, so the real order still goes through.
        usdc.mint(stranger, 10_000_000);
        vm.startPrank(stranger);
        usdc.approve(address(escrow), type(uint256).max);
        bytes32 theirs = escrow.deposit(REF, address(usdc), 1_000_000, TTL, type(uint256).max);
        vm.stopPrank();

        bytes32 ours = _deposit();
        assertTrue(theirs != ours);
    }

    function test_deposit_revertsOnReuse() public {
        _deposit();
        vm.prank(depositor);
        vm.expectRevert(VoucherEscrowV2.IdAlreadyUsed.selector);
        escrow.deposit(REF, address(usdc), AMOUNT, TTL, type(uint256).max);
    }

    function test_deposit_revertsWhenFeeAboveMaxTotal() public {
        vm.prank(owner);
        escrow.setFee(500, RESERVE_SHARE_BPS);
        vm.prank(depositor);
        vm.expectRevert(VoucherEscrowV2.TotalExceedsMax.selector);
        escrow.deposit(REF, address(usdc), AMOUNT, TTL, AMOUNT + FEE);
    }

    function test_deposit_enforcesTokenLimits() public {
        vm.startPrank(depositor);
        vm.expectRevert(VoucherEscrowV2.AmountOutOfRange.selector);
        escrow.deposit(REF, address(usdc), 999_999, TTL, type(uint256).max);
        vm.expectRevert(VoucherEscrowV2.AmountOutOfRange.selector);
        escrow.deposit(REF, address(usdc), 10_000_000_001, TTL, type(uint256).max);
        vm.expectRevert(VoucherEscrowV2.InvalidTtl.selector);
        escrow.deposit(REF, address(usdc), AMOUNT, 59 minutes, type(uint256).max);
        vm.expectRevert(VoucherEscrowV2.InvalidTtl.selector);
        escrow.deposit(REF, address(usdc), AMOUNT, 31 days, type(uint256).max);
        vm.expectRevert(VoucherEscrowV2.TokenNotAllowed.selector);
        escrow.deposit(REF, address(0xdead), AMOUNT, TTL, type(uint256).max);
        vm.stopPrank();
    }

    function test_deposit_enforcesTotalCap() public {
        vm.prank(owner);
        escrow.setToken(address(usdc), true, 1_000_000, 10_000_000_000, AMOUNT + FEE);
        bytes32 id = _deposit();
        vm.prank(depositor);
        vm.expectRevert(VoucherEscrowV2.CapExceeded.selector);
        escrow.deposit(keccak256("order-2"), address(usdc), 1_000_000, TTL, type(uint256).max);

        // Settling frees room under the cap.
        vm.prank(depositor);
        escrow.cancel(id);
        vm.prank(depositor);
        escrow.deposit(keccak256("order-2"), address(usdc), 1_000_000, TTL, type(uint256).max);
    }

    function test_deposit_rejectsFeeOnTransferToken() public {
        FeeOnTransferToken tax = new FeeOnTransferToken();
        vm.prank(owner);
        escrow.setToken(address(tax), true, 1, type(uint128).max, type(uint256).max);
        tax.mint(depositor, 1e24);
        vm.startPrank(depositor);
        tax.approve(address(escrow), type(uint256).max);
        vm.expectRevert(VoucherEscrowV2.ShortTransfer.selector);
        escrow.deposit(REF, address(tax), 1e18, TTL, type(uint256).max);
        vm.stopPrank();
    }

    function test_depositWithPermit_oneTransaction() public {
        (address alice, uint256 aliceKey) = makeAddrAndKey("alice");
        usdc.mint(alice, AMOUNT + FEE);
        uint256 maxTotal = AMOUNT + FEE;
        uint256 permitDeadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alice, aliceKey, maxTotal, permitDeadline);

        vm.prank(alice);
        bytes32 id = escrow.depositWithPermit(REF, address(usdc), AMOUNT, TTL, maxTotal, permitDeadline, v, r, s);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(escrow.getEscrow(id).depositor, alice);
    }

    function test_depositWithPermit_survivesFrontRunPermit() public {
        (address alice, uint256 aliceKey) = makeAddrAndKey("alice");
        usdc.mint(alice, AMOUNT + FEE);
        uint256 maxTotal = AMOUNT + FEE;
        uint256 permitDeadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alice, aliceKey, maxTotal, permitDeadline);

        // Someone submits the permit first; the deposit must still work.
        vm.prank(stranger);
        usdc.permit(alice, address(escrow), maxTotal, permitDeadline, v, r, s);
        vm.prank(alice);
        escrow.depositWithPermit(REF, address(usdc), AMOUNT, TTL, maxTotal, permitDeadline, v, r, s);
        assertEq(usdc.balanceOf(alice), 0);
    }

    function _signPermit(address holder, uint256 key, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                holder,
                address(escrow),
                value,
                usdc.nonces(holder),
                deadline
            )
        );
        return vm.sign(key, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)));
    }

    function test_deposit_blockedWhilePaused_exitsStillWork() public {
        bytes32 id = _delivered();
        vm.prank(guardian);
        escrow.pause();

        vm.prank(depositor);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.deposit(keccak256("order-2"), address(usdc), AMOUNT, TTL, type(uint256).max);

        vm.prank(depositor);
        escrow.release(id);
        assertEq(usdc.balanceOf(fulfiller), AMOUNT);
    }

    // ─────────────────────────── matching ──────────────────────────

    function test_assign_onlyDepositor() public {
        bytes32 id = _deposit();
        vm.prank(stranger);
        vm.expectRevert(VoucherEscrowV2.NotDepositor.selector);
        escrow.assign(id, stranger);

        vm.startPrank(depositor);
        vm.expectRevert(VoucherEscrowV2.InvalidFulfiller.selector);
        escrow.assign(id, depositor);
        escrow.assign(id, fulfiller);
        vm.expectRevert(VoucherEscrowV2.AlreadyAssigned.selector);
        escrow.assign(id, stranger);
        vm.stopPrank();

        VoucherEscrowV2.Escrow memory e = escrow.getEscrow(id);
        assertEq(e.fulfiller, fulfiller);
        assertEq(e.deadline, block.timestamp + FULFILL);
    }

    function test_assign_revertsAfterOrderExpired() public {
        bytes32 id = _deposit();
        vm.warp(block.timestamp + TTL);
        vm.prank(depositor);
        vm.expectRevert(VoucherEscrowV2.TooLate.selector);
        escrow.assign(id, fulfiller);
    }

    function test_accept_withDepositorSignature() public {
        bytes32 id = _deposit();
        uint64 validUntil = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _signAssign(depositorKey, id, fulfiller, validUntil);

        // The signature names the fulfiller: nobody else can use it.
        vm.prank(stranger);
        vm.expectRevert(VoucherEscrowV2.BadSignature.selector);
        escrow.accept(id, validUntil, sig);

        vm.prank(fulfiller);
        escrow.accept(id, validUntil, sig);
        assertEq(escrow.getEscrow(id).fulfiller, fulfiller);
    }

    function test_accept_revertsWhenExpiredOrForged() public {
        bytes32 id = _deposit();
        uint64 validUntil = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _signAssign(depositorKey, id, fulfiller, validUntil);

        (, uint256 otherKey) = makeAddrAndKey("other");
        bytes memory forged = _signAssign(otherKey, id, fulfiller, validUntil);
        vm.prank(fulfiller);
        vm.expectRevert(VoucherEscrowV2.BadSignature.selector);
        escrow.accept(id, validUntil, forged);

        vm.warp(validUntil + 1);
        vm.prank(fulfiller);
        vm.expectRevert(VoucherEscrowV2.SignatureExpired.selector);
        escrow.accept(id, validUntil, sig);
    }

    function test_accept_signatureCannotBeReplayedAfterUnassign() public {
        bytes32 id = _deposit();
        uint64 validUntil = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _signAssign(depositorKey, id, fulfiller, validUntil);
        vm.startPrank(fulfiller);
        escrow.accept(id, validUntil, sig);
        escrow.unassign(id);
        vm.expectRevert(VoucherEscrowV2.BadSignature.selector);
        escrow.accept(id, validUntil, sig);
        vm.stopPrank();
    }

    function test_accept_withSmartWalletDepositor() public {
        (address walletOwner, uint256 walletKey) = makeAddrAndKey("walletOwner");
        MockWallet wallet = new MockWallet(walletOwner);
        usdc.mint(address(wallet), AMOUNT + FEE);
        vm.startPrank(walletOwner);
        wallet.exec(address(usdc), abi.encodeCall(usdc.approve, (address(escrow), type(uint256).max)));
        wallet.exec(
            address(escrow), abi.encodeCall(escrow.deposit, (REF, address(usdc), AMOUNT, TTL, type(uint256).max))
        );
        vm.stopPrank();

        bytes32 id = escrow.escrowId(address(wallet), REF);
        uint64 validUntil = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _signAssign(walletKey, id, fulfiller, validUntil);
        vm.prank(fulfiller);
        escrow.accept(id, validUntil, sig);
        assertEq(escrow.getEscrow(id).fulfiller, fulfiller);
    }

    function test_unassign_reopensOrder() public {
        bytes32 id = _assigned();
        vm.prank(stranger);
        vm.expectRevert(VoucherEscrowV2.NotFulfiller.selector);
        escrow.unassign(id);

        vm.prank(fulfiller);
        escrow.unassign(id);
        VoucherEscrowV2.Escrow memory e = escrow.getEscrow(id);
        assertEq(e.fulfiller, address(0));
        assertEq(e.deadline, e.openUntil);
        assertEq(e.epoch, 1);

        vm.prank(depositor);
        escrow.assign(id, stranger);
        assertEq(escrow.getEscrow(id).fulfiller, stranger);
    }

    // ────────────────────────── happy path ─────────────────────────

    function test_release_paysFulfillerAndKeepsFee() public {
        bytes32 id = _delivered();
        vm.expectEmit(true, false, false, true);
        emit Settled(id, VoucherEscrowV2.Status.Released, AMOUNT, 0, FEE);
        vm.prank(depositor);
        escrow.release(id);

        assertEq(usdc.balanceOf(fulfiller), AMOUNT);
        assertEq(escrow.accruedFees(address(usdc)), FEE);
        assertEq(escrow.totalLocked(address(usdc)), 0);
        assertEq(uint8(_status(id)), uint8(VoucherEscrowV2.Status.Released));
        _assertSolvent();

        escrow.withdrawFees(address(usdc));
        assertEq(usdc.balanceOf(reserve), FEE / 2);
        assertEq(usdc.balanceOf(treasury), FEE - FEE / 2);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_release_allowedBeforeMarkDelivered() public {
        bytes32 id = _assigned();
        vm.prank(depositor);
        escrow.release(id);
        assertEq(usdc.balanceOf(fulfiller), AMOUNT);
    }

    function test_release_requiresDepositorAndFulfiller() public {
        bytes32 id = _deposit();
        vm.prank(depositor);
        vm.expectRevert(VoucherEscrowV2.NotAssigned.selector);
        escrow.release(id);

        vm.prank(depositor);
        escrow.assign(id, fulfiller);
        vm.prank(fulfiller);
        vm.expectRevert(VoucherEscrowV2.NotDepositor.selector);
        escrow.release(id);
        vm.prank(arbiter);
        vm.expectRevert(VoucherEscrowV2.NotDepositor.selector);
        escrow.release(id);
        vm.prank(owner);
        vm.expectRevert(VoucherEscrowV2.NotDepositor.selector);
        escrow.release(id);
    }

    function test_release_cannotSettleTwice() public {
        bytes32 id = _delivered();
        vm.startPrank(depositor);
        escrow.release(id);
        vm.expectRevert(VoucherEscrowV2.WrongStatus.selector);
        escrow.release(id);
        vm.expectRevert(VoucherEscrowV2.WrongStatus.selector);
        escrow.cancel(id);
        vm.stopPrank();
        vm.expectRevert(VoucherEscrowV2.WrongStatus.selector);
        escrow.claim(id);
        vm.expectRevert(VoucherEscrowV2.WrongStatus.selector);
        escrow.refundExpired(id);
    }

    function test_markDelivered_onlyFulfillerBeforeDeadline() public {
        bytes32 id = _assigned();
        vm.prank(stranger);
        vm.expectRevert(VoucherEscrowV2.NotFulfiller.selector);
        escrow.markDelivered(id, 0);

        vm.warp(block.timestamp + FULFILL);
        vm.prank(fulfiller);
        vm.expectRevert(VoucherEscrowV2.TooLate.selector);
        escrow.markDelivered(id, 0);
    }

    function test_claim_afterReviewWindow() public {
        bytes32 id = _delivered();
        vm.expectRevert(VoucherEscrowV2.TooEarly.selector);
        escrow.claim(id);

        vm.warp(block.timestamp + REVIEW);
        vm.prank(stranger); // anyone may trigger it; the money still goes to the fulfiller
        escrow.claim(id);
        assertEq(usdc.balanceOf(fulfiller), AMOUNT);
        assertEq(usdc.balanceOf(stranger), 0);
        _assertSolvent();
    }

    // ───────────────────────── refunds ─────────────────────────────

    function test_cancel_refundsEverythingWhileUnassigned() public {
        uint256 before = usdc.balanceOf(depositor);
        bytes32 id = _deposit();
        vm.prank(stranger);
        vm.expectRevert(VoucherEscrowV2.NotDepositor.selector);
        escrow.cancel(id);

        vm.prank(depositor);
        escrow.cancel(id);
        assertEq(usdc.balanceOf(depositor), before);
        assertEq(escrow.accruedFees(address(usdc)), 0);
        assertEq(uint8(_status(id)), uint8(VoucherEscrowV2.Status.Refunded));
        _assertSolvent();
    }

    function test_cancel_blockedOnceAssigned() public {
        bytes32 id = _assigned();
        vm.prank(depositor);
        vm.expectRevert(VoucherEscrowV2.AlreadyAssigned.selector);
        escrow.cancel(id);
    }

    function test_refundExpired_openOrder() public {
        uint256 before = usdc.balanceOf(depositor);
        bytes32 id = _deposit();
        vm.expectRevert(VoucherEscrowV2.TooEarly.selector);
        escrow.refundExpired(id);

        vm.warp(block.timestamp + TTL);
        vm.prank(stranger);
        escrow.refundExpired(id);
        assertEq(usdc.balanceOf(depositor), before);
    }

    function test_refundExpired_fulfillerMissedDeadline() public {
        uint256 before = usdc.balanceOf(depositor);
        bytes32 id = _assigned();
        vm.warp(block.timestamp + FULFILL - 1);
        vm.expectRevert(VoucherEscrowV2.TooEarly.selector);
        escrow.refundExpired(id);

        vm.warp(block.timestamp + 1);
        escrow.refundExpired(id);
        assertEq(usdc.balanceOf(depositor), before);
        assertEq(usdc.balanceOf(fulfiller), 0);
    }

    function test_refundExpired_notAvailableAfterDelivery() public {
        // The V1 hole: the depositor could wait out a timer and take the money back after delivery.
        bytes32 id = _delivered();
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(VoucherEscrowV2.WrongStatus.selector);
        escrow.refundExpired(id);
    }

    function test_concede_fulfillerReturnsFunds() public {
        uint256 before = usdc.balanceOf(depositor);
        bytes32 id = _delivered();
        vm.prank(depositor);
        vm.expectRevert(VoucherEscrowV2.NotFulfiller.selector);
        escrow.concede(id);

        vm.prank(fulfiller);
        escrow.concede(id);
        assertEq(usdc.balanceOf(depositor), before);
    }

    // ───────────────────────── disputes ────────────────────────────

    function test_dispute_freezesClaim() public {
        bytes32 id = _disputed();
        vm.warp(block.timestamp + REVIEW + 1);
        vm.expectRevert(VoucherEscrowV2.WrongStatus.selector);
        escrow.claim(id);
    }

    function test_dispute_onlyDepositorAfterDelivery() public {
        bytes32 id = _assigned();
        vm.prank(depositor);
        vm.expectRevert(VoucherEscrowV2.WrongStatus.selector);
        escrow.dispute(id, 0);

        vm.prank(fulfiller);
        escrow.markDelivered(id, 0);
        vm.prank(stranger);
        vm.expectRevert(VoucherEscrowV2.NotDepositor.selector);
        escrow.dispute(id, 0);
    }

    function test_dispute_stillPossibleAfterReviewWindowUntilClaimed() public {
        bytes32 id = _delivered();
        vm.warp(block.timestamp + REVIEW + 1);
        vm.prank(depositor);
        escrow.dispute(id, 0);
        assertEq(uint8(_status(id)), uint8(VoucherEscrowV2.Status.Disputed));
    }

    function test_resolve_split() public {
        uint256 before = usdc.balanceOf(depositor);
        bytes32 id = _disputed();
        uint256 toFulfiller = 40_000_000; // 40 USDC of 111.11
        uint256 feeKept = (FEE * toFulfiller) / AMOUNT;

        vm.prank(arbiter);
        escrow.resolve(id, toFulfiller);

        assertEq(usdc.balanceOf(fulfiller), toFulfiller);
        assertEq(usdc.balanceOf(depositor), before - toFulfiller - feeKept);
        assertEq(escrow.accruedFees(address(usdc)), feeKept);
        assertEq(uint8(_status(id)), uint8(VoucherEscrowV2.Status.Resolved));
        _assertSolvent();
    }

    function test_resolve_fullRefundKeepsNoFee() public {
        uint256 before = usdc.balanceOf(depositor);
        bytes32 id = _disputed();
        vm.prank(arbiter);
        escrow.resolve(id, 0);
        assertEq(usdc.balanceOf(depositor), before);
        assertEq(escrow.accruedFees(address(usdc)), 0);
    }

    function test_resolve_onlyArbiterOnlyDisputed() public {
        bytes32 id = _delivered();
        vm.prank(arbiter);
        vm.expectRevert(VoucherEscrowV2.WrongStatus.selector);
        escrow.resolve(id, AMOUNT); // the arbiter has no power without a dispute

        vm.prank(depositor);
        escrow.dispute(id, 0);
        vm.prank(owner);
        vm.expectRevert(VoucherEscrowV2.NotArbiter.selector);
        escrow.resolve(id, AMOUNT);
        vm.prank(arbiter);
        vm.expectRevert(VoucherEscrowV2.AmountOutOfRange.selector);
        escrow.resolve(id, AMOUNT + 1);
    }

    function test_disputedEscrow_partiesCanStillSettleThemselves() public {
        bytes32 id = _disputed();
        vm.prank(depositor);
        escrow.release(id);
        assertEq(usdc.balanceOf(fulfiller), AMOUNT);
    }

    function test_refundStaleDispute_afterTimeout() public {
        uint256 before = usdc.balanceOf(depositor);
        bytes32 id = _disputed();
        vm.expectRevert(VoucherEscrowV2.TooEarly.selector);
        escrow.refundStaleDispute(id);

        vm.warp(block.timestamp + 30 days);
        escrow.refundStaleDispute(id);
        assertEq(usdc.balanceOf(depositor), before);
    }

    function test_blockedFulfiller_isolatedToItsOwnEscrow() public {
        bytes32 id = _delivered();
        usdc.setBlocked(fulfiller, true);
        vm.prank(depositor);
        vm.expectRevert();
        escrow.release(id);

        // The depositor is not stuck: dispute, then the arbiter refunds.
        uint256 before = usdc.balanceOf(depositor);
        vm.prank(depositor);
        escrow.dispute(id, 0);
        vm.prank(arbiter);
        escrow.resolve(id, 0);
        assertEq(usdc.balanceOf(depositor), before + AMOUNT + FEE);
    }

    // ─────────────────────── snapshots and admin ───────────────────

    function test_parameterChangesDoNotTouchLiveEscrows() public {
        bytes32 id = _deposit();
        vm.startPrank(owner);
        escrow.setFee(500, 0);
        escrow.setWindows(7 days, 7 days);
        escrow.setToken(address(usdc), false, 0, 0, 0);
        vm.stopPrank();

        VoucherEscrowV2.Escrow memory e = escrow.getEscrow(id);
        assertEq(e.fee, FEE);
        assertEq(e.reviewWindow, REVIEW);
        assertEq(e.fulfillWindow, FULFILL);

        // A disabled token still settles.
        vm.prank(depositor);
        escrow.assign(id, fulfiller);
        vm.prank(depositor);
        escrow.release(id);
        assertEq(usdc.balanceOf(fulfiller), AMOUNT);
    }

    function test_admin_onlyOwner() public {
        vm.startPrank(stranger);
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger);
        vm.expectRevert(err);
        escrow.setArbiter(stranger);
        vm.expectRevert(err);
        escrow.setGuardian(stranger);
        vm.expectRevert(err);
        escrow.setFeeRecipients(stranger, stranger);
        vm.expectRevert(err);
        escrow.setFee(0, 0);
        vm.expectRevert(err);
        escrow.setWindows(REVIEW, FULFILL);
        vm.expectRevert(err);
        escrow.setToken(address(usdc), true, 1, 2, 3);
        vm.expectRevert(err);
        escrow.sweepExcess(address(usdc), stranger);
        vm.expectRevert(err);
        escrow.unpause();
        vm.expectRevert(VoucherEscrowV2.NotGuardian.selector);
        escrow.pause();
        vm.stopPrank();
    }

    function test_admin_boundsAreEnforced() public {
        vm.startPrank(owner);
        vm.expectRevert(VoucherEscrowV2.InvalidFee.selector);
        escrow.setFee(501, 0);
        vm.expectRevert(VoucherEscrowV2.InvalidFee.selector);
        escrow.setFee(100, 10_001);
        vm.expectRevert(VoucherEscrowV2.InvalidWindow.selector);
        escrow.setWindows(29 minutes, FULFILL);
        vm.expectRevert(VoucherEscrowV2.InvalidWindow.selector);
        escrow.setWindows(REVIEW, 8 days);
        vm.expectRevert(VoucherEscrowV2.ZeroAddress.selector);
        escrow.setArbiter(address(0));
        vm.expectRevert(VoucherEscrowV2.InvalidTokenConfig.selector);
        escrow.setToken(address(0xdead), true, 1, 2, 3); // not a contract
        vm.expectRevert(VoucherEscrowV2.InvalidTokenConfig.selector);
        escrow.setToken(address(usdc), true, 5, 2, 3);
        vm.expectRevert(VoucherEscrowV2.RenounceDisabled.selector);
        escrow.renounceOwnership();
        vm.stopPrank();
    }

    function test_ownershipTransferIsTwoStep() public {
        vm.prank(owner);
        escrow.transferOwnership(stranger);
        assertEq(escrow.owner(), owner);
        vm.prank(stranger);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), stranger);
    }

    function test_pause_guardianPausesOnlyOwnerUnpauses() public {
        vm.prank(guardian);
        escrow.pause();
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        escrow.unpause();
        vm.prank(owner);
        escrow.unpause();
        _deposit();
    }

    function test_sweepExcess_neverTakesEscrowedFundsOrFees() public {
        bytes32 id = _delivered();
        vm.prank(depositor);
        escrow.release(id); // fee accrued
        vm.prank(depositor);
        escrow.deposit(keccak256("order-2"), address(usdc), AMOUNT, TTL, type(uint256).max); // live escrow

        vm.prank(owner);
        vm.expectRevert(VoucherEscrowV2.NothingToWithdraw.selector);
        escrow.sweepExcess(address(usdc), owner);

        usdc.mint(address(escrow), 7_000_000); // sent by mistake
        vm.prank(owner);
        escrow.sweepExcess(address(usdc), owner);
        assertEq(usdc.balanceOf(owner), 7_000_000);
        _assertSolvent();
    }

    function test_withdrawFees_nothingToWithdraw() public {
        vm.expectRevert(VoucherEscrowV2.NothingToWithdraw.selector);
        escrow.withdrawFees(address(usdc));
    }

    function test_nativeValueIsRejected() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(escrow).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // ──────────────────────────── fuzz ─────────────────────────────

    function testFuzz_resolve_conservesFunds(uint256 amount, uint16 feeBps, uint256 toFulfiller) public {
        amount = bound(amount, 1_000_000, 10_000_000_000);
        feeBps = uint16(bound(feeBps, 0, 500));
        toFulfiller = bound(toFulfiller, 0, amount);
        vm.prank(owner);
        escrow.setFee(feeBps, RESERVE_SHARE_BPS);

        uint256 depositorBefore = usdc.balanceOf(depositor);
        vm.startPrank(depositor);
        bytes32 id = escrow.deposit(REF, address(usdc), amount, TTL, type(uint256).max);
        escrow.assign(id, fulfiller);
        vm.stopPrank();
        vm.prank(fulfiller);
        escrow.markDelivered(id, 0);
        vm.prank(depositor);
        escrow.dispute(id, 0);
        vm.prank(arbiter);
        escrow.resolve(id, toFulfiller);

        uint256 fee = (amount * feeBps) / 10_000;
        uint256 kept = escrow.accruedFees(address(usdc));
        assertEq(usdc.balanceOf(fulfiller), toFulfiller);
        assertLe(kept, fee);
        // Every unit locked is accounted for: fulfiller + depositor refund + fee kept.
        assertEq(depositorBefore - usdc.balanceOf(depositor), toFulfiller + kept);
        assertEq(usdc.balanceOf(address(escrow)), kept);
        assertEq(escrow.totalLocked(address(usdc)), 0);
    }

    function testFuzz_release_fulfillerGetsExactAmount(uint256 amount, uint16 feeBps) public {
        amount = bound(amount, 1_000_000, 10_000_000_000);
        feeBps = uint16(bound(feeBps, 0, 500));
        vm.prank(owner);
        escrow.setFee(feeBps, RESERVE_SHARE_BPS);

        vm.startPrank(depositor);
        bytes32 id = escrow.deposit(REF, address(usdc), amount, TTL, type(uint256).max);
        escrow.assign(id, fulfiller);
        escrow.release(id);
        vm.stopPrank();

        assertEq(usdc.balanceOf(fulfiller), amount);
        assertEq(escrow.accruedFees(address(usdc)), (amount * feeBps) / 10_000);
        _assertSolvent();
    }
}
