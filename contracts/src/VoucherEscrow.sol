// SPDX-License-Identifier: MIT
// AI-assisted: Codex. See AI_USAGE.md.
pragma solidity ^0.8.28;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {AttestorRegistry} from "./AttestorRegistry.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";
import {ReserveVault} from "./ReserveVault.sol";
import {Attestations} from "./lib/Attestations.sol";

/// Owner can configure FUTURE orders and pause new orders; no owner withdrawal,
/// upgrade, seizure, cancellation of another user's order, or pause of exits.
/// Balance signatures are trusted issuer observations, not proof of honest resale.
contract VoucherEscrow is Ownable2Step, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    uint256 public constant BPS = 10000;
    uint256 public constant MAX_VOUCHERS = 8;
    IERC20 public immutable usdc;
    AttestorRegistry public immutable attestors;
    IdentityRegistry public immutable identities;
    ReserveVault public immutable reserve;
    address public immutable treasury;
    address public disputeResolver;
    bool public newOrdersPaused;
    enum State {
        None,
        Open,
        Accepted,
        Delivered,
        Released,
        Closed,
        Cancelled,
        Expired,
        Slashed,
        Disputed
    }

    struct Parameters {
        uint16 feeBps;
        uint16 reserveShareBps;
        uint16 holdbackBps;
        uint32 acceptWindow;
        uint32 deliverWindow;
        uint32 confirmWindow;
        uint32 challengeWindow;
        uint32 disputeWindow;
    }
    Parameters public parameters;

    struct Order {
        address seller;
        address buyer;
        address resolver;
        bytes32 brandId;
        bytes32 recipientKeyHash;
        bytes32 sealedPayloadHash;
        uint128 faceValuePaise;
        uint128 principal;
        uint128 fee;
        uint128 held;
        uint64 acceptBy;
        uint64 deliverBy;
        uint64 deliveredAt;
        uint64 releasedAt;
        uint64 recheckAt;
        uint64 challengeUntil;
        uint64 disputeUntil;
        uint64 attestorEpoch;
        bool buyerMustBeVerified;
        State state;
        Parameters terms;
    }
    mapping(bytes32 => Order) private _orders;
    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public usedVoucher;
    mapping(bytes32 => mapping(bytes32 => bool)) public usedAttestation;
    mapping(bytes32 => bytes32[]) private _vouchers;
    mapping(bytes32 => mapping(bytes32 => uint256)) public deliveredBalance;
    mapping(bytes32 => mapping(bytes32 => bytes32)) public voucherIssuer;
    mapping(address => uint256) public credits;
    uint256 public escrowLiability;
    uint256 public creditLiability;
    event OrderCreated(
        bytes32 indexed id,
        address indexed seller,
        bytes32 indexed brandId,
        uint256 principal,
        uint256 fee,
        bytes32 recipientKeyHash
    );
    event Accepted(bytes32 indexed id, address indexed buyer, uint64 deliverBy);
    event Delivered(bytes32 indexed id, bytes32 sealedPayloadHash, uint64 deliveredAt);
    event Released(bytes32 indexed id, uint256 paid, uint256 held, uint64 challengeUntil);
    event Finalized(bytes32 indexed id, State state, uint256 sellerCredit, uint256 buyerCredit);
    event Slashed(bytes32 indexed id, uint256 refunded, uint256 shortfall);
    event Disputed(bytes32 indexed id, uint64 resolveBy);
    event ParametersChanged(Parameters parameters);
    event ResolverChanged(address indexed resolver);
    event NewOrdersPaused(bool paused);
    event Withdrawn(address indexed account, uint256 amount);
    error WrongState();
    error Unauthorized();
    error InvalidTerms();
    error InvalidAttestation();

    constructor(
        address owner_,
        IERC20 token,
        AttestorRegistry attestors_,
        IdentityRegistry identity_,
        ReserveVault reserve_,
        address treasury_,
        address resolver_,
        Parameters memory params
    ) Ownable(owner_) EIP712("NetPositive", "1") {
        require(
            address(token).code.length > 0 && IERC20Metadata(address(token)).decimals() == 6,
            "USDC interface must use 6 decimals"
        );
        require(treasury_ != address(0) && resolver_ != address(0), "Missing roles");
        usdc = token;
        attestors = attestors_;
        identities = identity_;
        reserve = reserve_;
        treasury = treasury_;
        disputeResolver = resolver_;
        _setParameters(params);
    }

    function getOrder(bytes32 id) external view returns (Order memory) {
        return _orders[id];
    }

    function vouchers(bytes32 id) external view returns (bytes32[] memory) {
        return _vouchers[id];
    }

    function setParameters(Parameters calldata p) external onlyOwner {
        _setParameters(p);
    }

    function _setParameters(Parameters memory p) private {
        if (
            p.feeBps > 100 || p.reserveShareBps > BPS || p.holdbackBps > 5000 || p.acceptWindow < 30
                || p.deliverWindow < 30 || p.confirmWindow < 30 || p.challengeWindow < 30 || p.disputeWindow < 30
                || p.acceptWindow > 30 days || p.deliverWindow > 30 days || p.confirmWindow > 30 days
                || p.challengeWindow > 30 days || p.disputeWindow > 30 days
        ) revert InvalidTerms();
        parameters = p;
        emit ParametersChanged(p);
    }

    function setResolver(address r) external onlyOwner {
        if (r == address(0)) revert InvalidTerms();
        disputeResolver = r;
        emit ResolverChanged(r);
    }

    function pauseNewOrders(bool paused) external onlyOwner {
        newOrdersPaused = paused;
        emit NewOrdersPaused(paused);
    }

    /// Fees truncate to cents, never exceeding the displayed 1%; principal retains USDC precision.
    function feeFor(uint256 amount, uint256 bps) public pure returns (uint256) {
        return (amount * bps / BPS / 10000) * 10000;
    }

    function nextOrderId(address seller) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), seller, nonces[seller]));
    }

    function createOrder(bytes32 brand, uint128 face, uint128 amount, bool verifiedBuyer, bytes32 recipientKeyHash)
        external
        nonReentrant
        returns (bytes32 id)
    {
        if (
            newOrdersPaused || brand == 0 || face == 0 || amount < 1e6 || amount > 1_000_000e6 || recipientKeyHash == 0
                || identities.isBanned(msg.sender)
        ) revert InvalidTerms();
        id = nextOrderId(msg.sender);
        nonces[msg.sender]++;
        Order storage o = _orders[id];
        o.seller = msg.sender;
        o.resolver = disputeResolver;
        o.brandId = brand;
        o.recipientKeyHash = recipientKeyHash;
        o.faceValuePaise = face;
        o.principal = amount;
        o.terms = parameters;
        o.fee = uint128(feeFor(amount, parameters.feeBps));
        o.acceptBy = uint64(block.timestamp) + parameters.acceptWindow;
        o.buyerMustBeVerified = verifiedBuyer;
        o.attestorEpoch = attestors.currentEpoch();
        o.state = State.Open;
        uint256 total = uint256(amount) + o.fee;
        escrowLiability += total;
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), total);
        require(usdc.balanceOf(address(this)) - beforeBalance == total, "Exact USDC deposit required");
        emit OrderCreated(id, msg.sender, brand, amount, o.fee, recipientKeyHash);
    }

    function cancelOrder(bytes32 id) external nonReentrant {
        Order storage o = _orders[id];
        if (o.state != State.Open) revert WrongState();
        if (msg.sender != o.seller) revert Unauthorized();
        _refund(id, State.Cancelled);
    }

    function acceptOrder(bytes32 id) external {
        Order storage o = _orders[id];
        if (o.state != State.Open || block.timestamp > o.acceptBy) revert WrongState();
        if (
            msg.sender == o.seller || msg.sender == o.resolver || identities.isBanned(msg.sender)
                || (o.buyerMustBeVerified && !identities.isVerified(msg.sender))
        ) revert Unauthorized();
        o.buyer = msg.sender;
        o.deliverBy = uint64(block.timestamp) + o.terms.deliverWindow;
        o.state = State.Accepted;
        emit Accepted(id, msg.sender, o.deliverBy);
    }

    function balanceDigest(bytes32 id, Attestations.BalanceAttestation calldata a, uint8 purpose)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(Attestations.orderHash(id, a, purpose));
    }

    function _verify(
        bytes32 id,
        Order storage o,
        Attestations.BalanceAttestation calldata a,
        bytes[] calldata signatures,
        uint8 purpose
    ) private {
        (, uint64 age) = attestors.epochs(o.attestorEpoch);
        if (
            a.voucherHash == 0 || a.issuerId == 0 || a.brandId != o.brandId || a.observedAt > block.timestamp
                || block.timestamp - a.observedAt > age || a.lastRedeemedAt > a.observedAt
        ) revert InvalidAttestation();
        bytes32 digest = balanceDigest(id, a, purpose);
        if (usedAttestation[id][digest]) revert InvalidAttestation();
        attestors.verify(o.attestorEpoch, digest, signatures);
        usedAttestation[id][digest] = true;
    }

    function deliverVoucher(
        bytes32 id,
        Attestations.BalanceAttestation[] calldata a,
        bytes[][] calldata signatures,
        bytes32 sealedHash
    ) external nonReentrant {
        Order storage o = _orders[id];
        if (o.state != State.Accepted || block.timestamp > o.deliverBy) revert WrongState();
        if (msg.sender != o.buyer) revert Unauthorized();
        if (a.length == 0 || a.length > MAX_VOUCHERS || a.length != signatures.length || sealedHash == 0) revert InvalidTerms();
        uint256 total;
        for (uint256 i; i < a.length; i++) {
            _verify(id, o, a[i], signatures[i], 0);
            if (a[i].redeemed || a[i].balancePaise == 0 || usedVoucher[a[i].voucherHash]) revert InvalidAttestation();
            usedVoucher[a[i].voucherHash] = true;
            _vouchers[id].push(a[i].voucherHash);
            deliveredBalance[id][a[i].voucherHash] = a[i].balancePaise;
            voucherIssuer[id][a[i].voucherHash] = a[i].issuerId;
            total += a[i].balancePaise;
        }
        if (total < o.faceValuePaise) revert InvalidAttestation();
        o.sealedPayloadHash = sealedHash;
        o.deliveredAt = uint64(block.timestamp);
        o.state = State.Delivered;
        emit Delivered(id, sealedHash, o.deliveredAt);
    }

    function confirmReceived(bytes32 id) external nonReentrant {
        Order storage o = _orders[id];
        if (msg.sender != o.seller) revert Unauthorized();
        if (o.state != State.Delivered) revert WrongState();
        _release(id);
    }

    function releaseWithRecheck(bytes32 id, Attestations.BalanceAttestation[] calldata a, bytes[][] calldata signatures)
        external
        nonReentrant
    {
        Order storage o = _orders[id];
        if (o.state != State.Delivered || block.timestamp <= o.deliveredAt + o.terms.confirmWindow) revert WrongState();
        bytes32[] storage list = _vouchers[id];
        if (a.length != list.length || a.length != signatures.length) revert InvalidTerms();
        uint64 earliest = type(uint64).max;
        for (uint256 i; i < a.length; i++) {
            _verify(id, o, a[i], signatures[i], 1);
            if (
                a[i].voucherHash != list[i] || a[i].issuerId != voucherIssuer[id][list[i]] || a[i].redeemed
                    || a[i].observedAt <= o.deliveredAt || a[i].balancePaise < deliveredBalance[id][list[i]]
            ) revert InvalidAttestation();
            if (a[i].observedAt < earliest) earliest = a[i].observedAt;
        }
        o.recheckAt = earliest;
        _release(id);
    }

    function _release(bytes32 id) private {
        Order storage o = _orders[id];
        o.held = uint128(uint256(o.principal) * o.terms.holdbackBps / BPS);
        o.releasedAt = uint64(block.timestamp);
        o.challengeUntil = uint64(block.timestamp) + o.terms.challengeWindow;
        o.state = State.Released;
        uint256 paid = uint256(o.principal) - o.held;
        escrowLiability -= paid + o.fee;
        _credit(o.buyer, paid);
        _earnFee(o, o.fee);
        emit Released(id, paid, o.held, o.challengeUntil);
    }

    function _earnFee(Order storage o, uint256 amount) private {
        uint256 reservePart = amount * o.terms.reserveShareBps / BPS;
        _credit(treasury, amount - reservePart);
        if (reservePart > 0) usdc.safeTransfer(address(reserve), reservePart);
    }

    function challenge(bytes32 id, Attestations.BalanceAttestation[] calldata a, bytes[][] calldata signatures)
        external
        nonReentrant
    {
        Order storage o = _orders[id];
        if (msg.sender != o.seller) revert Unauthorized();
        if (o.state != State.Delivered && o.state != State.Released) revert WrongState();
        if (o.state == State.Released && block.timestamp > o.challengeUntil) revert WrongState();
        if (a.length == 0 || a.length > MAX_VOUCHERS || a.length != signatures.length) revert InvalidTerms();
        bool bad;
        bool provable;
        for (uint256 i; i < a.length; i++) {
            _verify(id, o, a[i], signatures[i], 2);
            uint256 original = deliveredBalance[id][a[i].voucherHash];
            if (
                original == 0 || a[i].issuerId != voucherIssuer[id][a[i].voucherHash] || a[i].observedAt < o.deliveredAt
            ) {
                revert InvalidAttestation();
            }
            if (a[i].redeemed || a[i].balancePaise < original) {
                bad = true;
                if (
                    a[i].lastRedeemedAt != 0
                        && (a[i].lastRedeemedAt < o.deliveredAt
                            || (o.recheckAt != 0 && a[i].lastRedeemedAt < o.recheckAt))
                ) provable = true;
            }
        }
        if (!bad) revert InvalidAttestation();
        if (provable) {
            _slash(id);
        } else {
            o.state = State.Disputed;
            o.disputeUntil = uint64(block.timestamp) + o.terms.disputeWindow;
            emit Disputed(id, o.disputeUntil);
        }
    }

    function _slash(bytes32 id) private {
        Order storage o = _orders[id];
        bool released = o.releasedAt != 0;
        uint256 remaining = released ? o.held : uint256(o.principal) + o.fee;
        o.held = 0;
        o.state = State.Slashed;
        escrowLiability -= remaining;
        uint256 desired = uint256(o.principal) + o.fee;
        uint256 topup = released ? reserve.payout(id, desired - remaining) : 0;
        _credit(o.seller, remaining + topup);
        if (o.buyerMustBeVerified) identities.ban(o.buyer);
        emit Slashed(id, remaining + topup, desired - remaining - topup);
    }

    function resolveDispute(bytes32 id, uint16 sellerShareBps) external nonReentrant {
        Order storage o = _orders[id];
        if (o.state != State.Disputed || block.timestamp > o.disputeUntil) revert WrongState();
        if (msg.sender != o.resolver) revert Unauthorized();
        _resolve(id, sellerShareBps);
    }

    function settleStalledDispute(bytes32 id) external nonReentrant {
        Order storage o = _orders[id];
        if (o.state != State.Disputed || block.timestamp <= o.disputeUntil) revert WrongState();
        _resolve(id, 5000);
    }

    function _resolve(bytes32 id, uint16 share) private {
        if (share > BPS) revert InvalidTerms();
        Order storage o = _orders[id];
        uint256 sellerCredit;
        uint256 buyerCredit;
        if (o.releasedAt == 0) {
            uint256 returned = uint256(o.principal) * share / BPS;
            buyerCredit = uint256(o.principal) - returned;
            uint256 charged = uint256(o.fee) * buyerCredit / o.principal;
            sellerCredit = returned + o.fee - charged;
            escrowLiability -= uint256(o.principal) + o.fee;
            _earnFee(o, charged);
        } else {
            uint256 remaining = o.held;
            sellerCredit = remaining * share / BPS;
            buyerCredit = remaining - sellerCredit;
            escrowLiability -= remaining;
            o.held = 0;
        }
        o.state = State.Closed;
        _credit(o.seller, sellerCredit);
        _credit(o.buyer, buyerCredit);
        emit Finalized(id, o.state, sellerCredit, buyerCredit);
    }

    function closeOrder(bytes32 id) external nonReentrant {
        Order storage o = _orders[id];
        if (o.state != State.Released || block.timestamp <= o.challengeUntil) revert WrongState();
        uint256 held = o.held;
        o.held = 0;
        o.state = State.Closed;
        escrowLiability -= held;
        _credit(o.buyer, held);
        emit Finalized(id, o.state, 0, held);
    }

    function expireOrder(bytes32 id) external nonReentrant {
        Order storage o = _orders[id];
        if (!((o.state == State.Open && block.timestamp > o.acceptBy)
                    || (o.state == State.Accepted && block.timestamp > o.deliverBy))) revert WrongState();
        _refund(id, State.Expired);
    }

    function _refund(bytes32 id, State state) private {
        Order storage o = _orders[id];
        uint256 amount = uint256(o.principal) + o.fee;
        o.state = state;
        escrowLiability -= amount;
        _credit(o.seller, amount);
        emit Finalized(id, state, amount, 0);
    }

    function _credit(address account, uint256 amount) private {
        credits[account] += amount;
        creditLiability += amount;
    }

    function withdraw() external nonReentrant {
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert WrongState();
        credits[msg.sender] = 0;
        creditLiability -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function solvency() external view returns (uint256 balance, uint256 liabilities) {
        return (usdc.balanceOf(address(this)), escrowLiability + creditLiability);
    }
}
