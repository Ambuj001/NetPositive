// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title NetPositive
 * @notice Unaudited demo code for Arc Testnet; synthetic/testnet use only.
 * The buyer is the crypto seller and deposits principal plus a 1% fee. The
 * fulfiller delivers an encrypted voucher off chain and earns the full principal.
 * @dev Trust assumptions: the immutable validator must honestly attest that an
 * opaque encrypted payload identified by its digest was delivered to the buyer's
 * recipient commitment. It does NOT attest that the voucher is valid or unredeemed;
 * validity is covered by buyer review/dispute and the immutable arbitrator's ruling.
 * If arbitration is unavailable, an explicitly disclosed fallback splits principal
 * 50/50 (rounding in the buyer's favor) and refunds the entire fee to the buyer.
 * No plaintext voucher data ever touches the chain: only digests/commitments.
 * USDC issuer blocklist/freeze powers can still affect USDC balances and transfers;
 * this contract cannot prevent them. Withdrawals may redirect to another address,
 * but cannot bypass issuer restrictions on transfers out of this contract.
 * There is no admin, owner, proxy, pause, upgrade, seizure, or surplus recovery.
 * Accounting invariant (assuming normal USDC balance behavior):
 * USDC.balanceOf(address(this)) >= totalEscrowed + totalWithdrawable + disputeReserve.
 * Unsolicited donations increase unclaimable surplus, not any liability.
 * Deadlines are fixed when first set and cannot subsequently be modified.
 */
contract NetPositive is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    IERC20 public constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 public constant FEE_BPS = 100;
    uint256 public constant BPS = 10_000;
    uint256 public constant RESERVE_SHARE_BPS = 3_000;
    uint256 public constant MIN_PRINCIPAL = 1e6;
    /// @notice Unaudited-code safety guard, not a guarantee of safety.
    uint256 public constant MAX_PRINCIPAL = 10_000e6;
    uint256 public constant MIN_DELIVERY_WINDOW = 10 minutes;
    uint256 public constant MAX_DELIVERY_WINDOW = 7 days;
    bytes32 public constant DELIVERY_ATTESTATION_TYPEHASH = keccak256(
        "DeliveryAttestation(bytes32 tradeId,bytes32 deliveryDigest,bytes32 buyerRecipient,uint64 expiry)"
    );

    address public immutable validator;
    address public immutable arbitrator;
    address public immutable revenueRecipient;
    uint64 public immutable reviewPeriod;
    uint64 public immutable arbitrationPeriod;

    enum State {
        None,
        Open,
        Delivered,
        Disputed,
        Released,
        Refunded,
        ResolvedForBuyer,
        ResolvedForFulfiller,
        SplitFallback
    }

    struct Order {
        address buyer;
        State state;
        uint64 deliveryDeadline;
        address fulfiller;
        uint64 reviewDeadline;
        uint64 disputeDeadline;
        uint128 principal;
        uint128 fee;
        bytes32 buyerRecipient;
        bytes32 deliveryDigest;
    }

    mapping(bytes32 => Order) private _orders;
    mapping(address => uint256) public withdrawable;
    uint256 public totalEscrowed;
    uint256 public totalWithdrawable;
    uint256 public disputeReserve;

    error InvalidAddress();
    error InvalidRoles();
    error InvalidPeriods();
    error InvalidUSDC();
    error InvalidParticipant();
    error InvalidPrincipal();
    error InvalidDeliveryDeadline();
    error EmptyCommitment();
    error TradeAlreadyUsed(bytes32 tradeId);
    error UnexpectedState(State expected, State actual);
    error Unauthorized();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error AttestationExpired();
    error InvalidAttestation();
    error IncorrectDeposit(uint256 expected, uint256 balanceBefore, uint256 balanceAfter);
    error NothingToWithdraw();

    event OrderCreated(
        bytes32 indexed tradeId,
        address indexed buyer,
        address indexed fulfiller,
        uint256 principal,
        uint256 fee,
        uint64 deliveryDeadline,
        bytes32 buyerRecipient
    );
    event DeliverySubmitted(bytes32 indexed tradeId, bytes32 deliveryDigest, uint64 reviewDeadline);
    event OrderReleased(bytes32 indexed tradeId);
    event OrderRefunded(bytes32 indexed tradeId);
    event DisputeOpened(bytes32 indexed tradeId, uint64 disputeDeadline);
    event DisputeResolved(bytes32 indexed tradeId, bool payFulfiller, uint256 arbitratorPay);
    event DisputeFallback(bytes32 indexed tradeId, uint256 fulfillerAmount, uint256 buyerAmount);
    event Withdrawn(address indexed account, address indexed to, uint256 amount);

    constructor(
        address validator_,
        address arbitrator_,
        address revenueRecipient_,
        uint64 reviewPeriod_,
        uint64 arbitrationPeriod_
    ) EIP712("NetPositive", "1") {
        if (validator_ == address(0) || arbitrator_ == address(0) || revenueRecipient_ == address(0)) {
            revert InvalidAddress();
        }
        if (validator_ == arbitrator_) revert InvalidRoles();
        if (
            reviewPeriod_ < 1 hours || reviewPeriod_ > 7 days
                || arbitrationPeriod_ < 1 days || arbitrationPeriod_ > 30 days
        ) revert InvalidPeriods();
        if (address(USDC).code.length == 0) revert InvalidUSDC();
        try IERC20Metadata(address(USDC)).decimals() returns (uint8 decimals_) {
            if (decimals_ != 6) revert InvalidUSDC();
        } catch {
            revert InvalidUSDC();
        }
        validator = validator_;
        arbitrator = arbitrator_;
        revenueRecipient = revenueRecipient_;
        reviewPeriod = reviewPeriod_;
        arbitrationPeriod = arbitrationPeriod_;
    }

    /// @notice Buyer-scoped IDs prevent another account from squatting on a buyer's salt.
    /// @dev Creation, rather than this deterministic view, rejects already-used IDs.
    function computeTradeId(address buyer, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), buyer, salt));
    }

    function getOrder(bytes32 tradeId) external view returns (Order memory) {
        return _orders[tradeId];
    }

    function feeFor(uint256 principal) public pure returns (uint256) {
        return principal * FEE_BPS / BPS;
    }

    function reserveShareOf(uint256 fee) public pure returns (uint256) {
        return fee * RESERVE_SHARE_BPS / BPS;
    }

    function solvency() external view returns (uint256 balance, uint256 liabilities) {
        balance = USDC.balanceOf(address(this));
        liabilities = totalEscrowed + totalWithdrawable + disputeReserve;
    }

    function createOrder(
        bytes32 salt,
        address fulfiller,
        uint256 principal,
        uint64 deliveryDeadline,
        bytes32 buyerRecipient
    ) external nonReentrant returns (bytes32 tradeId) {
        if (
            fulfiller == address(0) || fulfiller == msg.sender
                || !_isParticipant(msg.sender) || !_isParticipant(fulfiller)
        ) revert InvalidParticipant();
        if (buyerRecipient == bytes32(0)) revert EmptyCommitment();
        if (principal < MIN_PRINCIPAL || principal > MAX_PRINCIPAL) revert InvalidPrincipal();
        if (
            uint256(deliveryDeadline) < block.timestamp + MIN_DELIVERY_WINDOW
                || uint256(deliveryDeadline) > block.timestamp + MAX_DELIVERY_WINDOW
        ) revert InvalidDeliveryDeadline();
        tradeId = computeTradeId(msg.sender, salt);
        if (_orders[tradeId].state != State.None) revert TradeAlreadyUsed(tradeId);
        uint256 fee = feeFor(principal);
        uint256 amount = principal + fee;
        uint256 balanceBefore = USDC.balanceOf(address(this));
        _orders[tradeId] = Order({
            buyer: msg.sender,
            state: State.Open,
            deliveryDeadline: deliveryDeadline,
            fulfiller: fulfiller,
            reviewDeadline: 0,
            disputeDeadline: 0,
            principal: principal.toUint128(),
            fee: fee.toUint128(),
            buyerRecipient: buyerRecipient,
            deliveryDigest: bytes32(0)
        });
        totalEscrowed += amount;
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = USDC.balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) {
            revert IncorrectDeposit(amount, balanceBefore, balanceAfter);
        }
        emit OrderCreated(tradeId, msg.sender, fulfiller, principal, fee, deliveryDeadline, buyerRecipient);
    }

    function hashDeliveryAttestation(
        bytes32 tradeId,
        bytes32 deliveryDigest,
        bytes32 buyerRecipient,
        uint64 expiry
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            DELIVERY_ATTESTATION_TYPEHASH, tradeId, deliveryDigest, buyerRecipient, expiry
        )));
    }

    function submitDelivery(
        bytes32 tradeId,
        bytes32 deliveryDigest,
        uint64 attestationExpiry,
        bytes calldata signature
    ) external nonReentrant {
        Order storage order = _orders[tradeId];
        _requireState(order, State.Open);
        if (msg.sender != order.fulfiller) revert Unauthorized();
        if (block.timestamp > order.deliveryDeadline) revert DeadlinePassed();
        if (block.timestamp > attestationExpiry) revert AttestationExpired();
        if (deliveryDigest == bytes32(0)) revert EmptyCommitment();
        bytes32 digest = hashDeliveryAttestation(
            tradeId, deliveryDigest, order.buyerRecipient, attestationExpiry
        );
        if (!SignatureChecker.isValidSignatureNow(validator, digest, signature)) revert InvalidAttestation();
        order.state = State.Delivered;
        order.deliveryDigest = deliveryDigest;
        order.reviewDeadline = (block.timestamp + reviewPeriod).toUint64();
        emit DeliverySubmitted(tradeId, deliveryDigest, order.reviewDeadline);
    }

    function acceptDelivery(bytes32 tradeId) external nonReentrant {
        Order storage order = _orders[tradeId];
        _requireState(order, State.Delivered);
        if (msg.sender != order.buyer) revert Unauthorized();
        _release(order);
        emit OrderReleased(tradeId);
    }

    function releaseAfterReview(bytes32 tradeId) external nonReentrant {
        Order storage order = _orders[tradeId];
        _requireState(order, State.Delivered);
        if (block.timestamp <= order.reviewDeadline) revert DeadlineNotPassed();
        _release(order);
        emit OrderReleased(tradeId);
    }

    function refundExpired(bytes32 tradeId) external nonReentrant {
        Order storage order = _orders[tradeId];
        _requireState(order, State.Open);
        if (block.timestamp <= order.deliveryDeadline) revert DeadlineNotPassed();
        order.state = State.Refunded;
        uint256 amount = uint256(order.principal) + order.fee;
        totalEscrowed -= amount;
        _credit(order.buyer, amount);
        emit OrderRefunded(tradeId);
    }

    function openDispute(bytes32 tradeId) external nonReentrant {
        Order storage order = _orders[tradeId];
        _requireState(order, State.Delivered);
        if (msg.sender != order.buyer) revert Unauthorized();
        if (block.timestamp > order.reviewDeadline) revert DeadlinePassed();
        order.state = State.Disputed;
        order.disputeDeadline = (block.timestamp + arbitrationPeriod).toUint64();
        emit DisputeOpened(tradeId, order.disputeDeadline);
    }

    function resolveDispute(bytes32 tradeId, bool payFulfiller) external nonReentrant {
        if (msg.sender != arbitrator) revert Unauthorized();
        Order storage order = _orders[tradeId];
        _requireState(order, State.Disputed);
        if (block.timestamp > order.disputeDeadline) revert DeadlinePassed();
        totalEscrowed -= uint256(order.principal) + order.fee;
        if (payFulfiller) {
            order.state = State.ResolvedForFulfiller;
            _credit(order.fulfiller, order.principal);
            _earnFee(order.fee);
        } else {
            order.state = State.ResolvedForBuyer;
            _credit(order.buyer, uint256(order.principal) + order.fee);
        }
        uint256 arbitratorPay = reserveShareOf(order.fee);
        if (arbitratorPay > disputeReserve) arbitratorPay = disputeReserve;
        disputeReserve -= arbitratorPay;
        _credit(arbitrator, arbitratorPay);
        emit DisputeResolved(tradeId, payFulfiller, arbitratorPay);
    }

    /**
     * @notice Explicitly disclosed 50/50 principal fallback when arbitration is
     * unavailable. Anyone may finalize only strictly after the fixed deadline.
     * @dev Fulfiller receives floor(principal/2); buyer receives the remainder and
     * the full unearned fee. No reserve contribution or arbitrator payment occurs.
     */
    function finalizeUnresolvedDispute(bytes32 tradeId) external nonReentrant {
        Order storage order = _orders[tradeId];
        _requireState(order, State.Disputed);
        if (block.timestamp <= order.disputeDeadline) revert DeadlineNotPassed();
        order.state = State.SplitFallback;
        uint256 fulfillerAmount = uint256(order.principal) / 2;
        uint256 buyerAmount = uint256(order.principal) - fulfillerAmount + order.fee;
        totalEscrowed -= uint256(order.principal) + order.fee;
        _credit(order.fulfiller, fulfillerAmount);
        _credit(order.buyer, buyerAmount);
        emit DisputeFallback(tradeId, fulfillerAmount, buyerAmount);
    }

    /// @notice Withdraw the caller's entire credit to a chosen recipient.
    /// @dev A failed transfer reverts only this withdrawal, preserving the credit.
    function withdraw(address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0) || to == address(this)) revert InvalidAddress();
        amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0;
        totalWithdrawable -= amount;
        USDC.safeTransfer(to, amount);
        emit Withdrawn(msg.sender, to, amount);
    }

    function _isParticipant(address account) private view returns (bool) {
        return account != validator && account != arbitrator && account != address(this);
    }

    function _requireState(Order storage order, State expected) private view {
        if (order.state != expected) revert UnexpectedState(expected, order.state);
    }

    function _release(Order storage order) private {
        order.state = State.Released;
        totalEscrowed -= uint256(order.principal) + order.fee;
        _credit(order.fulfiller, order.principal);
        _earnFee(order.fee);
    }

    function _earnFee(uint256 fee) private {
        uint256 reserveShare = reserveShareOf(fee);
        disputeReserve += reserveShare;
        _credit(revenueRecipient, fee - reserveShare);
    }

    function _credit(address account, uint256 amount) private {
        withdrawable[account] += amount;
        totalWithdrawable += amount;
    }
}
