// SPDX-License-Identifier: MIT
// AI-assisted: Codex. See AI_USAGE.md.
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AttestorRegistry} from "../src/AttestorRegistry.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {ReserveVault} from "../src/ReserveVault.sol";
import {VoucherEscrow} from "../src/VoucherEscrow.sol";
import {Attestations} from "../src/lib/Attestations.sol";
import {MockUSDC} from "../test/MockUSDC.sol";

contract ProtocolTest is Test {
    MockUSDC token;
    AttestorRegistry registry;
    IdentityRegistry identity;
    ReserveVault reserve;
    VoucherEscrow escrow;
    address seller = address(0x1001);
    address buyer = address(0x1002);
    address resolver = address(0x1003);
    address treasury = address(0x1004);
    address stranger = address(0x1005);
    uint256 validatorKey = 7777;
    uint256 humanKey = 8888;
    uint128 constant P = 111110000;
    uint128 constant FEE = 1110000;
    bytes32 constant BRAND = keccak256("lifestyle");
    bytes32 constant ISSUER = keccak256("synthetic-test-issuer");
    bytes32 constant KEYHASH = keccak256("synthetic-recipient-key");

    function setUp() public {
        vm.warp(1800000000);
        token = new MockUSDC();
        address[] memory validators = new address[](1);
        validators[0] = vm.addr(validatorKey);
        registry = new AttestorRegistry(address(this), validators, 1, 600, vm.addr(humanKey));
        identity = new IdentityRegistry(address(this), registry);
        reserve = new ReserveVault(address(this), IERC20(address(token)), 25e6, 100e6);
        escrow = new VoucherEscrow(
            address(this), IERC20(address(token)), registry, identity, reserve, treasury, resolver, params()
        );
        identity.bindEscrow(address(escrow));
        reserve.bindEscrow(address(escrow));
        token.mint(seller, 100000e6);
        vm.prank(seller);
        token.approve(address(escrow), type(uint256).max);
    }

    function params() internal pure returns (VoucherEscrow.Parameters memory) {
        return VoucherEscrow.Parameters(100, 5000, 1000, 600, 600, 300, 300, 600);
    }

    function sig(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function register(address account, bytes32 n) internal {
        Attestations.HumanAttestation memory a =
            Attestations.HumanAttestation(account, n, uint64(block.timestamp), uint64(block.timestamp + 1 days));
        bytes memory s = sig(humanKey, identity.digest(a));
        vm.prank(account);
        identity.register(a, s);
    }

    function create() internal returns (bytes32 id) {
        vm.prank(seller);
        id = escrow.createOrder(BRAND, 1000000, P, true, KEYHASH);
    }

    function accept(bytes32 id) internal {
        if (!identity.isVerified(buyer)) register(buyer, keccak256("human-test-1"));
        vm.prank(buyer);
        escrow.acceptOrder(id);
    }

    function balances() internal view returns (Attestations.BalanceAttestation[] memory a) {
        a = new Attestations.BalanceAttestation[](2);
        for (uint256 i; i < 2; i++) {
            a[i] = Attestations.BalanceAttestation(
                keccak256(abi.encode("synthetic-voucher", i)),
                ISSUER,
                BRAND,
                500000,
                false,
                0,
                uint64(block.timestamp),
                bytes32(0)
            );
        }
    }

    function signBalances(bytes32 id, Attestations.BalanceAttestation[] memory a, uint8 purpose)
        internal
        view
        returns (bytes[][] memory s)
    {
        s = new bytes[][](a.length);
        for (uint256 i; i < a.length; i++) {
            s[i] = new bytes[](1);
            s[i][0] = sig(validatorKey, escrow.balanceDigest(id, a[i], purpose));
        }
    }

    function delivered() internal returns (bytes32 id) {
        id = create();
        accept(id);
        Attestations.BalanceAttestation[] memory a = balances();
        bytes[][] memory s = signBalances(id, a, 0);
        vm.prank(buyer);
        escrow.deliverVoucher(id, a, s, keccak256("encrypted synthetic bundle"));
    }

    function spent(uint64 when) internal view returns (Attestations.BalanceAttestation[] memory a) {
        a = new Attestations.BalanceAttestation[](1);
        a[0] = balances()[0];
        a[0].redeemed = true;
        a[0].balancePaise = 0;
        a[0].lastRedeemedAt = when;
    }

    function challenge(bytes32 id, uint64 when) internal {
        Attestations.BalanceAttestation[] memory a = spent(when);
        bytes[][] memory s = signBalances(id, a, 2);
        vm.prank(seller);
        escrow.challenge(id, a, s);
    }

    function solvent() internal view {
        (uint256 b, uint256 l) = escrow.solvency();
        assertGe(b, l);
    }

    function test_WorkedExampleExactFeeHoldbackAndClose() public {
        bytes32 id = delivered();
        vm.prank(seller);
        escrow.confirmReceived(id);
        assertEq(escrow.credits(buyer), 99999000);
        assertEq(escrow.getOrder(id).held, 11111000);
        assertEq(token.balanceOf(address(reserve)), 555000);
        assertEq(escrow.credits(treasury), 555000);
        vm.prank(buyer);
        escrow.withdraw();
        vm.warp(block.timestamp + 301);
        vm.prank(stranger);
        escrow.closeOrder(id);
        vm.prank(buyer);
        escrow.withdraw();
        assertEq(token.balanceOf(buyer), P);
        assertEq(token.balanceOf(seller), 100000e6 - P - FEE);
        solvent();
    }

    function test_CancelOnlyBeforeAcceptanceAndOnlyBySeller() public {
        bytes32 id = create();
        vm.prank(stranger);
        vm.expectRevert();
        escrow.cancelOrder(id);
        vm.prank(seller);
        escrow.cancelOrder(id);
        assertEq(escrow.credits(seller), P + FEE);
        vm.prank(seller);
        vm.expectRevert();
        escrow.cancelOrder(id);
        solvent();
    }

    function test_ExpireOpenAndAcceptedPermissionlessly() public {
        bytes32 id = create();
        vm.warp(block.timestamp + 601);
        vm.prank(stranger);
        escrow.expireOrder(id);
        assertEq(escrow.credits(seller), P + FEE);
        id = create();
        accept(id);
        vm.warp(uint256(escrow.getOrder(id).deliverBy) + 1);
        escrow.expireOrder(id);
        assertEq(escrow.credits(seller), 2 * (P + FEE));
        solvent();
    }

    function test_IdentityRequiresTrustedFreshBoundSignature() public {
        Attestations.HumanAttestation memory a =
            Attestations.HumanAttestation(
            buyer, keccak256("n"), uint64(block.timestamp), uint64(block.timestamp + 1 days)
        );
        bytes memory bad = sig(123, identity.digest(a));
        vm.prank(buyer);
        vm.expectRevert();
        identity.register(a, bad);
        bytes memory valid = sig(humanKey, identity.digest(a));
        vm.prank(stranger);
        vm.expectRevert();
        identity.register(a, valid);
        vm.prank(buyer);
        identity.register(a, valid);
        assertTrue(identity.isVerified(buyer));
        vm.prank(buyer);
        vm.expectRevert();
        identity.register(a, valid);
        vm.warp(block.timestamp + 1 days + 1);
        assertFalse(identity.isVerified(buyer));
    }

    function test_UnverifiedBuyerCannotAccept() public {
        bytes32 id = create();
        vm.prank(buyer);
        vm.expectRevert();
        escrow.acceptOrder(id);
    }

    function test_DoubleSellAcrossOrdersReverts() public {
        delivered();
        bytes32 other = create();
        accept(other);
        Attestations.BalanceAttestation[] memory a = balances();
        bytes[][] memory s = signBalances(other, a, 0);
        vm.prank(buyer);
        vm.expectRevert();
        escrow.deliverVoucher(other, a, s, keccak256("second"));
    }

    function test_StaleFutureWrongBrandAndInsufficientBalanceFail() public {
        bytes32 id = create();
        accept(id);
        Attestations.BalanceAttestation[] memory a = balances();
        a[0].observedAt -= 601;
        bytes[][] memory s = signBalances(id, a, 0);
        vm.prank(buyer);
        vm.expectRevert();
        escrow.deliverVoucher(id, a, s, bytes32(uint256(1)));
        a = balances();
        a[0].observedAt++;
        s = signBalances(id, a, 0);
        vm.prank(buyer);
        vm.expectRevert();
        escrow.deliverVoucher(id, a, s, bytes32(uint256(1)));
        a = balances();
        a[0].brandId = keccak256("wrong");
        s = signBalances(id, a, 0);
        vm.prank(buyer);
        vm.expectRevert();
        escrow.deliverVoucher(id, a, s, bytes32(uint256(1)));
        a = balances();
        a[0].balancePaise = 499999;
        s = signBalances(id, a, 0);
        vm.prank(buyer);
        vm.expectRevert();
        escrow.deliverVoucher(id, a, s, bytes32(uint256(1)));
    }

    function test_AttestationsBoundToOrderAndPurpose() public {
        bytes32 id = create();
        accept(id);
        Attestations.BalanceAttestation[] memory a = balances();
        bytes[][] memory s = signBalances(bytes32(uint256(999)), a, 0);
        vm.prank(buyer);
        vm.expectRevert();
        escrow.deliverVoucher(id, a, s, bytes32(uint256(1)));
        s = signBalances(id, a, 1);
        vm.prank(buyer);
        vm.expectRevert();
        escrow.deliverVoucher(id, a, s, bytes32(uint256(1)));
    }

    function test_DeliveryAndConfirmationCannotReplay() public {
        bytes32 id = delivered();
        Attestations.BalanceAttestation[] memory a = balances();
        bytes[][] memory s = signBalances(id, a, 0);
        vm.prank(buyer);
        vm.expectRevert();
        escrow.deliverVoucher(id, a, s, bytes32(uint256(1)));
        vm.prank(seller);
        escrow.confirmReceived(id);
        vm.prank(seller);
        vm.expectRevert();
        escrow.confirmReceived(id);
    }

    function test_FreshRecheckReleasesOnlyAfterReview() public {
        bytes32 id = delivered();
        Attestations.BalanceAttestation[] memory a = balances();
        bytes[][] memory s = signBalances(id, a, 1);
        vm.expectRevert();
        escrow.releaseWithRecheck(id, a, s);
        vm.warp(block.timestamp + 301);
        a = balances();
        s = signBalances(id, a, 1);
        vm.prank(stranger);
        escrow.releaseWithRecheck(id, a, s);
        assertEq(uint8(escrow.getOrder(id).state), uint8(VoucherEscrow.State.Released));
        assertEq(escrow.getOrder(id).recheckAt, block.timestamp);
        solvent();
    }

    function test_RecheckCannotUseDeliveryProofOrDuplicateVoucher() public {
        bytes32 id = delivered();
        vm.warp(block.timestamp + 301);
        Attestations.BalanceAttestation[] memory a = balances();
        bytes[][] memory s = signBalances(id, a, 0);
        vm.expectRevert();
        escrow.releaseWithRecheck(id, a, s);
        a[1] = a[0];
        s = signBalances(id, a, 1);
        vm.expectRevert();
        escrow.releaseWithRecheck(id, a, s);
    }

    function test_PreDeliveryRedemptionSlashesAndBansNullifier() public {
        bytes32 id = delivered();
        uint64 beforeDelivery = uint64(block.timestamp - 1);
        vm.warp(block.timestamp + 10);
        challenge(id, beforeDelivery);
        assertEq(uint8(escrow.getOrder(id).state), uint8(VoucherEscrow.State.Slashed));
        assertEq(escrow.credits(seller), P + FEE);
        assertTrue(identity.isBanned(buyer));
        Attestations.HumanAttestation memory retry = Attestations.HumanAttestation(
            stranger, keccak256("human-test-1"), uint64(block.timestamp), uint64(block.timestamp + 1 days)
        );
        bytes memory retrySig = sig(humanKey, identity.digest(retry));
        vm.prank(stranger);
        vm.expectRevert();
        identity.register(retry, retrySig);
        solvent();
    }

    function test_NoTimestampIsAmbiguousAndOnlyResolverCanSplit() public {
        bytes32 id = delivered();
        vm.warp(block.timestamp + 10);
        challenge(id, 0);
        assertEq(uint8(escrow.getOrder(id).state), uint8(VoucherEscrow.State.Disputed));
        assertFalse(identity.isBanned(buyer));
        vm.prank(stranger);
        vm.expectRevert();
        escrow.resolveDispute(id, 5000);
        vm.prank(resolver);
        escrow.resolveDispute(id, 5000);
        assertEq(escrow.credits(buyer), P / 2);
        assertEq(escrow.credits(seller), P / 2 + FEE / 2);
        solvent();
    }

    function test_StalledDisputeHasPermissionlessExit() public {
        bytes32 id = delivered();
        challenge(id, 0);
        vm.expectRevert();
        escrow.settleStalledDispute(id);
        vm.warp(block.timestamp + 601);
        vm.prank(stranger);
        escrow.settleStalledDispute(id);
        assertEq(uint8(escrow.getOrder(id).state), uint8(VoucherEscrow.State.Closed));
        solvent();
    }

    function test_RefundAfterReleaseIsBoundedByActualReserve() public {
        bytes32 id = delivered();
        uint64 when = uint64(block.timestamp - 1);
        vm.prank(seller);
        escrow.confirmReceived(id);
        vm.prank(buyer);
        escrow.withdraw();
        vm.warp(block.timestamp + 10);
        challenge(id, when);
        assertEq(escrow.credits(seller), 11111000 + 555000);
        assertEq(token.balanceOf(address(reserve)), 0);
        solvent();
    }

    function test_BlockedBuyerCannotBlockSettlementOrOtherWithdrawals() public {
        bytes32 id = delivered();
        token.setBlocked(buyer, true);
        vm.prank(seller);
        escrow.confirmReceived(id);
        vm.prank(buyer);
        vm.expectRevert();
        escrow.withdraw();
        assertEq(escrow.credits(buyer), 99999000);
        vm.prank(treasury);
        escrow.withdraw();
        assertEq(token.balanceOf(treasury), 555000);
        solvent();
    }

    function test_OwnerChangesAffectFutureOrdersOnlyAndCannotTakeFunds() public {
        bytes32 id = delivered();
        VoucherEscrow.Parameters memory p = params();
        p.holdbackBps = 5000;
        escrow.setParameters(p);
        escrow.setResolver(stranger);
        escrow.pauseNewOrders(true);
        assertEq(escrow.getOrder(id).terms.holdbackBps, 1000);
        assertEq(escrow.getOrder(id).resolver, resolver);
        vm.expectRevert();
        escrow.withdraw();
        vm.expectRevert();
        escrow.cancelOrder(id);
        vm.expectRevert();
        identity.ban(buyer);
        vm.prank(seller);
        escrow.confirmReceived(id);
        vm.prank(buyer);
        escrow.withdraw();
        solvent();
    }

    function test_TrustEpochChangesDoNotInvalidateExistingOrders() public {
        bytes32 id = create();
        address[] memory next = new address[](1);
        next[0] = vm.addr(9999);
        registry.configure(next, 1, 60, vm.addr(humanKey));
        accept(id);
        Attestations.BalanceAttestation[] memory a = balances();
        bytes[][] memory s = signBalances(id, a, 0);
        vm.prank(buyer);
        escrow.deliverVoucher(id, a, s, bytes32(uint256(1)));
        assertEq(escrow.getOrder(id).attestorEpoch, 1);
    }

    function test_ReserveCapsAndAuthorization() public {
        token.mint(address(reserve), 1000e6);
        vm.expectRevert();
        reserve.payout(bytes32(uint256(1)), 100e6);
        for (uint256 i = 1; i <= 4; i++) {
            vm.prank(address(escrow));
            assertEq(reserve.payout(bytes32(i), 100e6), 25e6);
        }
        vm.prank(address(escrow));
        assertEq(reserve.payout(bytes32(uint256(5)), 100e6), 0);
        vm.warp(block.timestamp + 1 days);
        vm.prank(address(escrow));
        assertEq(reserve.payout(bytes32(uint256(5)), 100e6), 25e6);
        vm.prank(address(escrow));
        assertEq(reserve.payout(bytes32(uint256(5)), 100e6), 0);
    }

    function test_ThresholdRejectsDuplicateSigner() public {
        address a = vm.addr(validatorKey);
        address b = vm.addr(9999);
        address[] memory list = new address[](2);
        list[0] = a < b ? a : b;
        list[1] = a < b ? b : a;
        registry.configure(list, 2, 600, vm.addr(humanKey));
        bytes32 digest = keccak256("quorum");
        bytes[] memory s = new bytes[](2);
        s[0] = sig(validatorKey, digest);
        s[1] = s[0];
        uint64 epoch = registry.currentEpoch();
        vm.expectRevert();
        registry.verify(epoch, digest, s);
        s[0] = sig(a < b ? validatorKey : 9999, digest);
        s[1] = sig(a < b ? 9999 : validatorKey, digest);
        registry.verify(registry.currentEpoch(), digest, s);
    }

    function testFuzz_FeeAlwaysAtMostOnePercentAndWholeCents(uint128 raw) public view {
        uint256 amount = bound(raw, 1e6, 1_000_000e6);
        uint256 fee = escrow.feeFor(amount, 100);
        assertLe(fee, amount / 100);
        assertEq(fee % 10000, 0);
        assertLt(amount / 100 - fee, 10000);
    }
}
