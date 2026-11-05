// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {NetPositive} from "../NetPositive.sol";

/// @dev 6-decimal mock USDC. Storage-based flags (set AFTER vm.etch) add a
/// fee-on-transfer mode and per-address transfer blocking.
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;
    bool public feeOnTransfer;
    uint256 public totalSupply;

    function decimals() public view virtual returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
        totalSupply += amt;
    }

    function setBlocked(address who, bool b) external {
        blocked[who] = b;
    }

    function setFeeOnTransfer(bool b) external {
        feeOnTransfer = b;
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        _move(msg.sender, to, amt);
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= amt, "allowance");
            allowance[from][msg.sender] = a - amt;
        }
        _move(from, to, amt);
        return true;
    }

    function _move(address from, address to, uint256 amt) internal {
        require(!blocked[to], "blocked");
        require(balanceOf[from] >= amt, "balance");
        balanceOf[from] -= amt;
        uint256 received = feeOnTransfer && amt > 0 ? amt - 1 : amt;
        balanceOf[to] += received;
        totalSupply -= (amt - received);
    }
}

contract MockUSDC18 is MockUSDC {
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}

/// @dev Has code but no decimals() function.
contract NoDecimalsToken {
    uint256 public foo = 1;
}

abstract contract NetPositiveTestBase is Test {
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    uint64 internal constant REVIEW = 1 days;
    uint64 internal constant ARB = 3 days;
    bytes32 internal constant RECIP = keccak256("buyer-recipient");
    bytes32 internal constant DIGEST = keccak256("delivery-digest");
    uint256 internal constant P = 100e6;

    NetPositive internal np;
    MockUSDC internal usdc;

    address internal validator;
    uint256 internal validatorPk;
    address internal arbitrator = makeAddr("arbitrator");
    address internal revenue = makeAddr("revenue");
    address internal buyer = makeAddr("buyer");
    address internal buyer2 = makeAddr("buyer2");
    address internal fulfiller = makeAddr("fulfiller");
    address internal stranger = makeAddr("stranger");
    address internal other = makeAddr("other");

    function setUp() public virtual {
        (validator, validatorPk) = makeAddrAndKey("validator");
        vm.warp(1_700_000_000);
        _etchUsdc(address(new MockUSDC()));
        np = new NetPositive(validator, arbitrator, revenue, REVIEW, ARB);
        address[2] memory buyers = [buyer, buyer2];
        for (uint256 i = 0; i < 2; i++) {
            usdc.mint(buyers[i], 1_000_000e6);
            vm.prank(buyers[i]);
            usdc.approve(address(np), type(uint256).max);
        }
    }

    function _etchUsdc(address impl) internal {
        vm.etch(USDC_ADDR, impl.code);
        usdc = MockUSDC(USDC_ADDR);
    }

    function _create(bytes32 salt, uint256 principal) internal returns (bytes32) {
        vm.prank(buyer);
        return np.createOrder(salt, fulfiller, principal, uint64(block.timestamp + 1 days), RECIP);
    }

    function _signDigest(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sign(uint256 pk, bytes32 id, bytes32 dd, bytes32 recip, uint64 expiry)
        internal
        view
        returns (bytes memory)
    {
        return _signDigest(pk, np.hashDeliveryAttestation(id, dd, recip, expiry));
    }

    function _typedDigest(uint256 chainId, address verifying, bytes32 id, bytes32 dd, bytes32 recip, uint64 expiry)
        internal
        view
        returns (bytes32)
    {
        bytes32 domainSep = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("NetPositive"),
                keccak256("1"),
                chainId,
                verifying
            )
        );
        bytes32 structHash =
            keccak256(abi.encode(np.DELIVERY_ATTESTATION_TYPEHASH(), id, dd, recip, expiry));
        return keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
    }

    function _deliver(bytes32 id) internal {
        uint64 exp = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(validatorPk, id, DIGEST, RECIP, exp);
        vm.prank(fulfiller);
        np.submitDelivery(id, DIGEST, exp, sig);
    }

    function _createDelivered(bytes32 salt, uint256 principal) internal returns (bytes32 id) {
        id = _create(salt, principal);
        _deliver(id);
    }

    function _createDisputed(bytes32 salt, uint256 principal) internal returns (bytes32 id) {
        id = _createDelivered(salt, principal);
        vm.prank(buyer);
        np.openDispute(id);
    }

    function _state(bytes32 id) internal view returns (NetPositive.State) {
        return np.getOrder(id).state;
    }

    function _liabilities() internal view returns (uint256) {
        return np.totalEscrowed() + np.totalWithdrawable() + np.disputeReserve();
    }
}

contract NetPositiveTest is NetPositiveTestBase {
    // ------------------------------------------------------------ constructor
    function _deploy(address v, address a, address r, uint64 rp, uint64 ap) internal returns (NetPositive) {
        return new NetPositive(v, a, r, rp, ap);
    }

    function test_Constructor_StoresConfig() public view {
        assertEq(np.validator(), validator);
        assertEq(np.arbitrator(), arbitrator);
        assertEq(np.revenueRecipient(), revenue);
        assertEq(np.reviewPeriod(), REVIEW);
        assertEq(np.arbitrationPeriod(), ARB);
        assertEq(address(np.USDC()), USDC_ADDR);
    }

    function test_Constructor_RevertsZeroAddresses() public {
        vm.expectRevert(NetPositive.InvalidAddress.selector);
        _deploy(address(0), arbitrator, revenue, REVIEW, ARB);
        vm.expectRevert(NetPositive.InvalidAddress.selector);
        _deploy(validator, address(0), revenue, REVIEW, ARB);
        vm.expectRevert(NetPositive.InvalidAddress.selector);
        _deploy(validator, arbitrator, address(0), REVIEW, ARB);
    }

    function test_Constructor_RevertsSameValidatorAndArbitrator() public {
        vm.expectRevert(NetPositive.InvalidRoles.selector);
        _deploy(validator, validator, revenue, REVIEW, ARB);
    }

    function test_Constructor_RevertsBadPeriods() public {
        vm.expectRevert(NetPositive.InvalidPeriods.selector);
        _deploy(validator, arbitrator, revenue, 1 hours - 1, ARB);
        vm.expectRevert(NetPositive.InvalidPeriods.selector);
        _deploy(validator, arbitrator, revenue, 7 days + 1, ARB);
        vm.expectRevert(NetPositive.InvalidPeriods.selector);
        _deploy(validator, arbitrator, revenue, REVIEW, 1 days - 1);
        vm.expectRevert(NetPositive.InvalidPeriods.selector);
        _deploy(validator, arbitrator, revenue, REVIEW, 30 days + 1);
    }

    function test_Constructor_AcceptsPeriodBounds() public {
        _deploy(validator, arbitrator, revenue, 1 hours, 1 days);
        _deploy(validator, arbitrator, revenue, 7 days, 30 days);
    }

    function test_Constructor_RevertsWhenUsdcHasNoCode() public {
        vm.etch(USDC_ADDR, "");
        vm.expectRevert(NetPositive.InvalidUSDC.selector);
        _deploy(validator, arbitrator, revenue, REVIEW, ARB);
    }

    function test_Constructor_RevertsWhenUsdcHas18Decimals() public {
        _etchUsdc(address(new MockUSDC18()));
        vm.expectRevert(NetPositive.InvalidUSDC.selector);
        _deploy(validator, arbitrator, revenue, REVIEW, ARB);
    }

    function test_Constructor_RevertsWhenUsdcLacksDecimals() public {
        vm.etch(USDC_ADDR, address(new NoDecimalsToken()).code);
        vm.expectRevert(NetPositive.InvalidUSDC.selector);
        _deploy(validator, arbitrator, revenue, REVIEW, ARB);
    }

    // ------------------------------------------------------------ createOrder
    function test_CreateOrder_HappyPathStoresOrderAndPullsFunds() public {
        uint64 dl = uint64(block.timestamp + 1 days);
        bytes32 id = _create("s1", P);
        assertEq(id, np.computeTradeId(buyer, "s1"));
        NetPositive.Order memory o = np.getOrder(id);
        assertEq(o.buyer, buyer);
        assertEq(o.fulfiller, fulfiller);
        assertEq(uint8(o.state), uint8(NetPositive.State.Open));
        assertEq(o.principal, P);
        assertEq(o.fee, 1e6);
        assertEq(o.deliveryDeadline, dl);
        assertEq(o.buyerRecipient, RECIP);
        assertEq(o.reviewDeadline, 0);
        assertEq(np.totalEscrowed(), P + 1e6);
        assertEq(usdc.balanceOf(address(np)), P + 1e6);
        assertEq(usdc.balanceOf(buyer), 1_000_000e6 - P - 1e6);
    }

    function test_CreateOrder_EmitsOrderCreated() public {
        uint64 dl = uint64(block.timestamp + 1 days);
        bytes32 id = np.computeTradeId(buyer, "s1");
        vm.expectEmit(true, true, true, true, address(np));
        emit NetPositive.OrderCreated(id, buyer, fulfiller, P, 1e6, dl, RECIP);
        vm.prank(buyer);
        np.createOrder("s1", fulfiller, P, dl, RECIP);
    }

    function test_CreateOrder_SameSaltDifferentBuyersDistinctIds() public {
        _create("s", P);
        vm.prank(buyer2);
        bytes32 id2 = np.createOrder("s", fulfiller, P, uint64(block.timestamp + 1 days), RECIP);
        assertTrue(id2 != np.computeTradeId(buyer, "s"));
    }

    function test_CreateOrder_RevertsInvalidParticipants() public {
        uint64 dl = uint64(block.timestamp + 1 days);
        vm.startPrank(buyer);
        vm.expectRevert(NetPositive.InvalidParticipant.selector);
        np.createOrder("a", address(0), P, dl, RECIP);
        vm.expectRevert(NetPositive.InvalidParticipant.selector);
        np.createOrder("a", buyer, P, dl, RECIP); // self-dealing
        vm.expectRevert(NetPositive.InvalidParticipant.selector);
        np.createOrder("a", validator, P, dl, RECIP);
        vm.expectRevert(NetPositive.InvalidParticipant.selector);
        np.createOrder("a", arbitrator, P, dl, RECIP);
        vm.expectRevert(NetPositive.InvalidParticipant.selector);
        np.createOrder("a", address(np), P, dl, RECIP);
        vm.stopPrank();
    }

    function test_CreateOrder_RevertsWhenValidatorOrArbitratorIsBuyer() public {
        uint64 dl = uint64(block.timestamp + 1 days);
        vm.prank(validator);
        vm.expectRevert(NetPositive.InvalidParticipant.selector);
        np.createOrder("a", fulfiller, P, dl, RECIP);
        vm.prank(arbitrator);
        vm.expectRevert(NetPositive.InvalidParticipant.selector);
        np.createOrder("a", fulfiller, P, dl, RECIP);
    }

    function test_CreateOrder_RevertsZeroRecipient() public {
        vm.prank(buyer);
        vm.expectRevert(NetPositive.EmptyCommitment.selector);
        np.createOrder("a", fulfiller, P, uint64(block.timestamp + 1 days), bytes32(0));
    }

    function test_CreateOrder_PrincipalBounds() public {
        uint64 dl = uint64(block.timestamp + 1 days);
        vm.startPrank(buyer);
        vm.expectRevert(NetPositive.InvalidPrincipal.selector);
        np.createOrder("lo", fulfiller, 1e6 - 1, dl, RECIP);
        vm.expectRevert(NetPositive.InvalidPrincipal.selector);
        np.createOrder("hi", fulfiller, 10_000e6 + 1, dl, RECIP);
        np.createOrder("min", fulfiller, 1e6, dl, RECIP);
        np.createOrder("max", fulfiller, 10_000e6, dl, RECIP);
        vm.stopPrank();
    }

    function test_CreateOrder_DeadlineBounds() public {
        uint256 t = block.timestamp;
        vm.startPrank(buyer);
        vm.expectRevert(NetPositive.InvalidDeliveryDeadline.selector);
        np.createOrder("lo", fulfiller, P, uint64(t + 10 minutes - 1), RECIP);
        vm.expectRevert(NetPositive.InvalidDeliveryDeadline.selector);
        np.createOrder("hi", fulfiller, P, uint64(t + 7 days + 1), RECIP);
        np.createOrder("min", fulfiller, P, uint64(t + 10 minutes), RECIP);
        np.createOrder("max", fulfiller, P, uint64(t + 7 days), RECIP);
        vm.stopPrank();
    }

    function test_CreateOrder_RevertsDuplicateTradeId() public {
        bytes32 id = _create("dup", P);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(NetPositive.TradeAlreadyUsed.selector, id));
        np.createOrder("dup", fulfiller, P, uint64(block.timestamp + 1 days), RECIP);
    }

    function test_CreateOrder_RevertsWithoutAllowance() public {
        address poor = makeAddr("poor");
        usdc.mint(poor, 1_000e6);
        vm.prank(poor);
        vm.expectRevert();
        np.createOrder("a", fulfiller, P, uint64(block.timestamp + 1 days), RECIP);
    }

    function test_CreateOrder_RejectsFeeOnTransferToken() public {
        usdc.setFeeOnTransfer(true);
        uint256 amount = P + 1e6;
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(NetPositive.IncorrectDeposit.selector, amount, 0, amount - 1));
        np.createOrder("fot", fulfiller, P, uint64(block.timestamp + 1 days), RECIP);
        assertEq(np.totalEscrowed(), 0);
    }

    // ------------------------------------------------------------ submitDelivery
    function test_Submit_HappyPath() public {
        bytes32 id = _create("s", P);
        uint64 exp = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(validatorPk, id, DIGEST, RECIP, exp);
        vm.expectEmit(true, false, false, true, address(np));
        emit NetPositive.DeliverySubmitted(id, DIGEST, uint64(block.timestamp + REVIEW));
        vm.prank(fulfiller);
        np.submitDelivery(id, DIGEST, exp, sig);
        NetPositive.Order memory o = np.getOrder(id);
        assertEq(uint8(o.state), uint8(NetPositive.State.Delivered));
        assertEq(o.deliveryDigest, DIGEST);
        assertEq(o.reviewDeadline, block.timestamp + REVIEW);
    }

    function test_Submit_HelperDigestMatchesContractDomain() public {
        bytes32 id = _create("s", P);
        assertEq(_typedDigest(block.chainid, address(np), id, DIGEST, RECIP, 99), np.hashDeliveryAttestation(id, DIGEST, RECIP, 99));
    }

    function _submitExpectRevert(bytes32 id, bytes32 dd, uint64 exp, bytes memory sig, bytes memory err) internal {
        vm.prank(fulfiller);
        vm.expectRevert(err);
        np.submitDelivery(id, dd, exp, sig);
    }

    function test_Submit_RevertsWrongSigner() public {
        bytes32 id = _create("s", P);
        uint64 exp = uint64(block.timestamp + 1 hours);
        (, uint256 badPk) = makeAddrAndKey("badSigner");
        _submitExpectRevert(id, DIGEST, exp, _sign(badPk, id, DIGEST, RECIP, exp), abi.encodeWithSelector(NetPositive.InvalidAttestation.selector));
    }

    function test_Submit_RevertsWrongTradeId() public {
        bytes32 id = _create("s", P);
        bytes32 id2 = _create("s2", P);
        uint64 exp = uint64(block.timestamp + 1 hours);
        _submitExpectRevert(id, DIGEST, exp, _sign(validatorPk, id2, DIGEST, RECIP, exp), abi.encodeWithSelector(NetPositive.InvalidAttestation.selector));
    }

    function test_Submit_RevertsWrongDigest() public {
        bytes32 id = _create("s", P);
        uint64 exp = uint64(block.timestamp + 1 hours);
        _submitExpectRevert(id, keccak256("other"), exp, _sign(validatorPk, id, DIGEST, RECIP, exp), abi.encodeWithSelector(NetPositive.InvalidAttestation.selector));
    }

    function test_Submit_RevertsWrongBuyerRecipient() public {
        bytes32 id = _create("s", P);
        uint64 exp = uint64(block.timestamp + 1 hours);
        _submitExpectRevert(id, DIGEST, exp, _sign(validatorPk, id, DIGEST, keccak256("evil"), exp), abi.encodeWithSelector(NetPositive.InvalidAttestation.selector));
    }

    function test_Submit_RevertsWhenExpiryAlteredAfterSigning() public {
        bytes32 id = _create("s", P);
        uint64 exp = uint64(block.timestamp + 1 hours);
        _submitExpectRevert(id, DIGEST, exp + 1, _sign(validatorPk, id, DIGEST, RECIP, exp), abi.encodeWithSelector(NetPositive.InvalidAttestation.selector));
    }

    function test_Submit_RevertsExpiredAttestationButAllowsBoundary() public {
        bytes32 id = _create("s", P);
        uint64 exp = uint64(block.timestamp + 100);
        bytes memory sig = _sign(validatorPk, id, DIGEST, RECIP, exp);
        vm.warp(exp + 1);
        _submitExpectRevert(id, DIGEST, exp, sig, abi.encodeWithSelector(NetPositive.AttestationExpired.selector));
        vm.warp(exp);
        vm.prank(fulfiller);
        np.submitDelivery(id, DIGEST, exp, sig);
        assertEq(uint8(_state(id)), uint8(NetPositive.State.Delivered));
    }

    function test_Submit_RevertsReplayAfterDelivery() public {
        bytes32 id = _create("s", P);
        uint64 exp = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(validatorPk, id, DIGEST, RECIP, exp);
        vm.prank(fulfiller);
        np.submitDelivery(id, DIGEST, exp, sig);
        _submitExpectRevert(id, DIGEST, exp, sig, abi.encodeWithSelector(NetPositive.UnexpectedState.selector, NetPositive.State.Open, NetPositive.State.Delivered));
    }

    function test_Submit_RevertsNonFulfiller() public {
        bytes32 id = _create("s", P);
        uint64 exp = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(validatorPk, id, DIGEST, RECIP, exp);
        vm.prank(stranger);
        vm.expectRevert(NetPositive.Unauthorized.selector);
        np.submitDelivery(id, DIGEST, exp, sig);
        vm.prank(buyer);
        vm.expectRevert(NetPositive.Unauthorized.selector);
        np.submitDelivery(id, DIGEST, exp, sig);
    }

    function test_Submit_RevertsAfterDeliveryDeadlineButAllowsBoundary() public {
        bytes32 id = _create("s", P);
        uint64 dl = np.getOrder(id).deliveryDeadline;
        uint64 exp = dl + 1 hours;
        bytes memory sig = _sign(validatorPk, id, DIGEST, RECIP, exp);
        vm.warp(dl + 1);
        _submitExpectRevert(id, DIGEST, exp, sig, abi.encodeWithSelector(NetPositive.DeadlinePassed.selector));
        vm.warp(dl);
        vm.prank(fulfiller);
        np.submitDelivery(id, DIGEST, exp, sig);
    }

    function test_Submit_RevertsZeroDigest() public {
        bytes32 id = _create("s", P);
        uint64 exp = uint64(block.timestamp + 1 hours);
        _submitExpectRevert(id, bytes32(0), exp, _sign(validatorPk, id, bytes32(0), RECIP, exp), abi.encodeWithSelector(NetPositive.EmptyCommitment.selector));
    }

    function test_Submit_RevertsOtherChainIdSignature() public {
        bytes32 id = _create("s", P);
        uint64 exp = uint64(block.timestamp + 1 hours);
        bytes32 d = _typedDigest(block.chainid + 1, address(np), id, DIGEST, RECIP, exp);
        _submitExpectRevert(id, DIGEST, exp, _signDigest(validatorPk, d), abi.encodeWithSelector(NetPositive.InvalidAttestation.selector));
    }

    function test_Submit_RevertsOtherContractDomainSignature() public {
        bytes32 id = _create("s", P);
        uint64 exp = uint64(block.timestamp + 1 hours);
        NetPositive np2 = _deploy(validator, arbitrator, revenue, REVIEW, ARB);
        bytes32 d = np2.hashDeliveryAttestation(id, DIGEST, RECIP, exp);
        assertTrue(d != np.hashDeliveryAttestation(id, DIGEST, RECIP, exp));
        _submitExpectRevert(id, DIGEST, exp, _signDigest(validatorPk, d), abi.encodeWithSelector(NetPositive.InvalidAttestation.selector));
    }

    function test_Submit_RevertsGarbageAndEmptySignature() public {
        bytes32 id = _create("s", P);
        uint64 exp = uint64(block.timestamp + 1 hours);
        _submitExpectRevert(id, DIGEST, exp, "", abi.encodeWithSelector(NetPositive.InvalidAttestation.selector));
        _submitExpectRevert(id, DIGEST, exp, new bytes(65), abi.encodeWithSelector(NetPositive.InvalidAttestation.selector));
    }

    function test_Submit_RevertsUnknownTrade() public {
        vm.prank(fulfiller);
        vm.expectRevert(abi.encodeWithSelector(NetPositive.UnexpectedState.selector, NetPositive.State.Open, NetPositive.State.None));
        np.submitDelivery(bytes32(uint256(1)), DIGEST, uint64(block.timestamp + 1), "");
    }
}
