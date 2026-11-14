// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title VoucherEscrowV2
/// @notice Stablecoin escrow for voucher-for-crypto trades.
///
/// Parties
///   depositor  locks `amount + fee` and wants a voucher.
///   fulfiller  buys the voucher, delivers it and is paid `amount`.
///   arbiter    can only split an escrow that the depositor has put in dispute.
///   guardian   can only pause new deposits.
///   owner      (a multisig) sets parameters for future deposits. It cannot move any escrow.
///
/// Life of an escrow
///   deposit ─► Funded (open) ─ assign/accept ─► Funded (assigned) ─ markDelivered ─► Delivered
///   Funded (open)      cancel by depositor, or refundExpired after `openUntil`
///   Funded (assigned)  unassign by fulfiller, release by depositor, or refundExpired after the fulfil deadline
///   Delivered          release by depositor, claim after the review window, dispute by depositor, concede by fulfiller
///   Disputed           resolve by arbiter, release by depositor, concede by fulfiller,
///                      or refundStaleDispute after DISPUTE_TIMEOUT (so funds can never be stuck)
///
/// Dispute stake: to dispute, the depositor locks the token's `disputeBond` on top. If the arbiter rules for the
/// fulfiller the stake goes to the fulfiller (in proportion, on a split); in every other ending it returns to the depositor.
///
/// No single key can pay an escrow to an arbitrary address: funds only ever go to the escrow's own
/// depositor or the fulfiller the depositor named. Fee, windows and limits are copied into each escrow
/// at deposit, so later parameter changes never touch live escrows.
///
/// @dev `escrows(id)` keeps the three-value shape of V1 (status 1 == Funded) so CodeMailbox works unchanged.
contract VoucherEscrowV2 is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Funded,
        Delivered,
        Disputed,
        Released,
        Refunded,
        Resolved
    }

    struct Escrow {
        address depositor;
        uint64 openUntil; // an unassigned escrow can be refunded from this time
        uint32 epoch; // bumped on unassign, so an old Assign signature cannot be replayed
        address fulfiller;
        uint64 deadline; // end of the current phase: open, fulfil, review or dispute
        Status status;
        address token;
        uint32 reviewWindow;
        uint32 fulfillWindow;
        uint128 amount; // paid to the fulfiller on release
        uint128 fee; // locked on top of `amount`
        uint128 bond; // stake the depositor must add to dispute; held only while Disputed
    }

    struct TokenConfig {
        bool enabled;
        uint128 minAmount;
        uint128 maxAmount; // per escrow
        uint256 cap; // total locked across all live escrows, fees included
        uint128 disputeBond; // stake required to dispute an escrow in this token (0 = none)
    }

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 500;
    uint64 public constant MIN_TTL = 1 hours;
    uint64 public constant MAX_TTL = 30 days;
    uint32 public constant MIN_REVIEW_WINDOW = 30 minutes;
    uint32 public constant MAX_REVIEW_WINDOW = 7 days;
    uint32 public constant MIN_FULFILL_WINDOW = 15 minutes;
    uint32 public constant MAX_FULFILL_WINDOW = 7 days;
    uint64 public constant DISPUTE_TIMEOUT = 30 days;

    bytes32 public constant ASSIGN_TYPEHASH =
        keccak256("Assign(bytes32 id,address fulfiller,uint32 epoch,uint64 validUntil)");

    mapping(bytes32 => Escrow) private _escrows;
    mapping(address => TokenConfig) public tokenConfig;
    /// @notice Principal plus fee of all live escrows, per token.
    mapping(address => uint256) public totalLocked;
    /// @notice Fees earned and not yet withdrawn, per token.
    mapping(address => uint256) public accruedFees;

    address public arbiter;
    address public guardian;
    address public treasury;
    address public reserve;
    uint16 public feeBps;
    uint16 public reserveShareBps;
    uint32 public reviewWindow;
    uint32 public fulfillWindow;

    error ZeroAddress();
    error ZeroAmount();
    error InvalidFee();
    error InvalidWindow();
    error InvalidTtl();
    error InvalidTokenConfig();
    error TokenNotAllowed();
    error AmountOutOfRange();
    error CapExceeded();
    error TotalExceedsMax();
    error IdAlreadyUsed();
    error WrongStatus();
    error NotDepositor();
    error NotFulfiller();
    error NotArbiter();
    error NotGuardian();
    error AlreadyAssigned();
    error NotAssigned();
    error InvalidFulfiller();
    error TooEarly();
    error TooLate();
    error SignatureExpired();
    error BadSignature();
    error ShortTransfer();
    error NothingToWithdraw();
    error RenounceDisabled();

    event Deposited(
        bytes32 indexed id,
        address indexed depositor,
        address indexed token,
        bytes32 ref,
        uint256 amount,
        uint256 fee,
        uint64 openUntil
    );
    event Assigned(bytes32 indexed id, address indexed fulfiller, uint64 deliverBy);
    event Unassigned(bytes32 indexed id, address indexed fulfiller);
    event Delivered(bytes32 indexed id, address indexed fulfiller, bytes32 evidence, uint64 reviewEnds);
    event Disputed(bytes32 indexed id, bytes32 reason, uint256 bond, uint64 timeoutAt);
    /// @dev Emitted once per escrow when it ends. `status` is Released, Refunded or Resolved.
    /// `toFulfiller` and `toDepositor` are what each received in total; `bondToFulfiller` is the forfeited stake
    /// included in `toFulfiller`.
    event Settled(
        bytes32 indexed id,
        Status status,
        uint256 toFulfiller,
        uint256 toDepositor,
        uint256 feeKept,
        uint256 bondToFulfiller
    );
    event FeesWithdrawn(address indexed token, uint256 toTreasury, uint256 toReserve);
    event ExcessSwept(address indexed token, address indexed to, uint256 amount);
    event ArbiterUpdated(address indexed arbiter);
    event GuardianUpdated(address indexed guardian);
    event FeeRecipientsUpdated(address indexed treasury, address indexed reserve);
    event FeeUpdated(uint16 feeBps, uint16 reserveShareBps);
    event WindowsUpdated(uint32 reviewWindow, uint32 fulfillWindow);
    event TokenConfigured(
        address indexed token, bool enabled, uint128 minAmount, uint128 maxAmount, uint256 cap, uint128 disputeBond
    );

    constructor(
        address owner_,
        address arbiter_,
        address guardian_,
        address treasury_,
        address reserve_,
        uint16 feeBps_,
        uint16 reserveShareBps_,
        uint32 reviewWindow_,
        uint32 fulfillWindow_
    ) Ownable(owner_) EIP712("NetPositiveEscrow", "2") {
        _setArbiter(arbiter_);
        _setGuardian(guardian_);
        _setFeeRecipients(treasury_, reserve_);
        _setFee(feeBps_, reserveShareBps_);
        _setWindows(reviewWindow_, fulfillWindow_);
    }

    // ───────────────────────────── views ─────────────────────────────

    /// @notice The id of the escrow that `depositor` creates with `ref`. Nobody else can occupy it.
    function escrowId(address depositor, bytes32 ref) public pure returns (bytes32) {
        return keccak256(abi.encode(depositor, ref));
    }

    /// @notice V1-compatible view. `status` is 1 while the escrow is funded and not yet delivered.
    function escrows(bytes32 id) external view returns (address depositor, uint256 amount, uint8 status) {
        Escrow storage e = _escrows[id];
        return (e.depositor, e.amount, uint8(e.status));
    }

    function getEscrow(bytes32 id) external view returns (Escrow memory) {
        return _escrows[id];
    }

    /// @notice Fee that a deposit of `amount` locks on top, at the current rate.
    function quoteFee(uint256 amount) public view returns (uint256) {
        return (amount * feeBps) / BPS;
    }

    /// @notice EIP-712 digest the depositor signs to let `fulfiller` accept the escrow.
    function assignDigest(bytes32 id, address fulfiller, uint64 validUntil) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ASSIGN_TYPEHASH, id, fulfiller, _escrows[id].epoch, validUntil)));
    }

    // ──────────────────────────── deposit ────────────────────────────

    /// @param ref      Caller-chosen reference (for example keccak256 of the order id).
    /// @param amount   What the fulfiller will receive. The fee is pulled on top.
    /// @param ttl      Seconds the order stays open for a fulfiller.
    /// @param maxTotal Reverts if `amount + fee` is higher, so a fee change cannot surprise the caller.
    function deposit(bytes32 ref, address token, uint256 amount, uint64 ttl, uint256 maxTotal)
        external
        nonReentrant
        whenNotPaused
        returns (bytes32)
    {
        return _deposit(ref, token, amount, ttl, maxTotal);
    }

    /// @notice Deposit in one transaction with an EIP-2612 permit signed for `maxTotal`.
    /// @dev A failed permit is ignored: if someone already submitted it, the allowance is in place.
    function depositWithPermit(
        bytes32 ref,
        address token,
        uint256 amount,
        uint64 ttl,
        uint256 maxTotal,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused returns (bytes32) {
        try IERC20Permit(token).permit(msg.sender, address(this), maxTotal, permitDeadline, v, r, s) {} catch {}
        return _deposit(ref, token, amount, ttl, maxTotal);
    }

    function _deposit(bytes32 ref, address token, uint256 amount, uint64 ttl, uint256 maxTotal)
        private
        returns (bytes32 id)
    {
        TokenConfig memory cfg = tokenConfig[token];
        if (!cfg.enabled) revert TokenNotAllowed();
        if (amount == 0) revert ZeroAmount();
        if (amount < cfg.minAmount || amount > cfg.maxAmount) revert AmountOutOfRange();
        if (ttl < MIN_TTL || ttl > MAX_TTL) revert InvalidTtl();

        id = escrowId(msg.sender, ref);
        Escrow storage e = _escrows[id];
        if (e.status != Status.None) revert IdAlreadyUsed();

        uint256 fee = quoteFee(amount);
        uint256 total = amount + fee;
        if (total > maxTotal) revert TotalExceedsMax();
        uint256 locked = totalLocked[token] + total;
        if (locked > cfg.cap) revert CapExceeded();
        totalLocked[token] = locked;

        uint64 openUntil = uint64(block.timestamp) + ttl;
        e.depositor = msg.sender;
        e.openUntil = openUntil;
        e.deadline = openUntil;
        e.status = Status.Funded;
        e.token = token;
        e.reviewWindow = reviewWindow;
        e.fulfillWindow = fulfillWindow;
        // Both casts are safe: amount <= cfg.maxAmount (a uint128) and fee <= amount * 5%.
        // forge-lint: disable-next-line(unsafe-typecast)
        e.amount = uint128(amount);
        // forge-lint: disable-next-line(unsafe-typecast)
        e.fee = uint128(fee);
        e.bond = cfg.disputeBond;
        emit Deposited(id, msg.sender, token, ref, amount, fee, openUntil);

        // Fee-on-transfer and other short-paying tokens are rejected: the escrow must receive exactly `total`.
        uint256 beforeBal = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), total);
        if (IERC20(token).balanceOf(address(this)) - beforeBal != total) revert ShortTransfer();
    }

    // ──────────────────────────── matching ───────────────────────────

    /// @notice The depositor names the fulfiller directly.
    function assign(bytes32 id, address fulfiller) external {
        Escrow storage e = _escrows[id];
        if (msg.sender != e.depositor) revert NotDepositor();
        _assign(id, e, fulfiller);
    }

    /// @notice The fulfiller accepts with the depositor's gasless Assign signature (EOA or ERC-1271 wallet).
    function accept(bytes32 id, uint64 validUntil, bytes calldata signature) external {
        Escrow storage e = _escrows[id];
        if (block.timestamp > validUntil) revert SignatureExpired();
        if (!SignatureChecker.isValidSignatureNow(e.depositor, assignDigest(id, msg.sender, validUntil), signature)) {
            revert BadSignature();
        }
        _assign(id, e, msg.sender);
    }

    function _assign(bytes32 id, Escrow storage e, address fulfiller) private {
        if (e.status != Status.Funded) revert WrongStatus();
        if (e.fulfiller != address(0)) revert AlreadyAssigned();
        if (fulfiller == address(0) || fulfiller == e.depositor) revert InvalidFulfiller();
        if (block.timestamp >= e.openUntil) revert TooLate();
        uint64 deliverBy = uint64(block.timestamp) + e.fulfillWindow;
        e.fulfiller = fulfiller;
        e.deadline = deliverBy;
        emit Assigned(id, fulfiller, deliverBy);
    }

    /// @notice The fulfiller steps away before delivering; the order is open again.
    function unassign(bytes32 id) external {
        Escrow storage e = _escrows[id];
        if (e.status != Status.Funded) revert WrongStatus();
        if (msg.sender != e.fulfiller) revert NotFulfiller();
        e.fulfiller = address(0);
        e.deadline = e.openUntil;
        unchecked {
            ++e.epoch;
        }
        emit Unassigned(id, msg.sender);
    }

    // ─────────────────────────── fulfilment ──────────────────────────

    /// @notice The fulfiller declares the voucher delivered and starts the depositor's review window.
    /// @param evidence Optional hash of the delivery (for example the CodeMailbox ciphertext hash).
    function markDelivered(bytes32 id, bytes32 evidence) external {
        Escrow storage e = _escrows[id];
        if (e.status != Status.Funded) revert WrongStatus();
        if (msg.sender != e.fulfiller) revert NotFulfiller();
        if (block.timestamp >= e.deadline) revert TooLate();
        uint64 reviewEnds = uint64(block.timestamp) + e.reviewWindow;
        e.status = Status.Delivered;
        e.deadline = reviewEnds;
        emit Delivered(id, msg.sender, evidence, reviewEnds);
    }

    /// @notice The depositor confirms the voucher. Allowed any time after a fulfiller is assigned.
    function release(bytes32 id) external nonReentrant {
        Escrow storage e = _escrows[id];
        if (msg.sender != e.depositor) revert NotDepositor();
        Status s = e.status;
        if (s != Status.Funded && s != Status.Delivered && s != Status.Disputed) revert WrongStatus();
        if (e.fulfiller == address(0)) revert NotAssigned();
        _settle(id, e, Status.Released, e.amount);
    }

    /// @notice Anyone may pay the fulfiller once the review window ended without a dispute.
    function claim(bytes32 id) external nonReentrant {
        Escrow storage e = _escrows[id];
        if (e.status != Status.Delivered) revert WrongStatus();
        if (block.timestamp < e.deadline) revert TooEarly();
        _settle(id, e, Status.Released, e.amount);
    }

    // ───────────────────────── refunds, disputes ─────────────────────

    /// @notice The depositor withdraws an order nobody has taken.
    function cancel(bytes32 id) external nonReentrant {
        Escrow storage e = _escrows[id];
        if (msg.sender != e.depositor) revert NotDepositor();
        if (e.status != Status.Funded) revert WrongStatus();
        if (e.fulfiller != address(0)) revert AlreadyAssigned();
        _settle(id, e, Status.Refunded, 0);
    }

    /// @notice Anyone may refund the depositor once the order expired unassigned or undelivered.
    function refundExpired(bytes32 id) external nonReentrant {
        Escrow storage e = _escrows[id];
        if (e.status != Status.Funded) revert WrongStatus();
        if (block.timestamp < e.deadline) revert TooEarly();
        _settle(id, e, Status.Refunded, 0);
    }

    /// @notice The depositor contests a delivery and locks the dispute stake (approve it first).
    /// Only the arbiter, or the two parties, can end a dispute.
    function dispute(bytes32 id, bytes32 reason) external nonReentrant {
        Escrow storage e = _escrows[id];
        if (msg.sender != e.depositor) revert NotDepositor();
        if (e.status != Status.Delivered) revert WrongStatus();
        uint64 timeoutAt = uint64(block.timestamp) + DISPUTE_TIMEOUT;
        uint256 bond = e.bond;
        address token = e.token;
        e.status = Status.Disputed;
        e.deadline = timeoutAt;
        emit Disputed(id, reason, bond, timeoutAt);

        if (bond != 0) {
            totalLocked[token] += bond;
            uint256 beforeBal = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransferFrom(msg.sender, address(this), bond);
            if (IERC20(token).balanceOf(address(this)) - beforeBal != bond) revert ShortTransfer();
        }
    }

    /// @notice The fulfiller gives the money back after marking delivered.
    function concede(bytes32 id) external nonReentrant {
        Escrow storage e = _escrows[id];
        if (msg.sender != e.fulfiller) revert NotFulfiller();
        if (e.status != Status.Delivered && e.status != Status.Disputed) revert WrongStatus();
        _settle(id, e, Status.Refunded, 0);
    }

    /// @notice The arbiter splits a disputed escrow. The fee is kept in proportion to what the fulfiller gets.
    function resolve(bytes32 id, uint256 toFulfiller) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter();
        Escrow storage e = _escrows[id];
        if (e.status != Status.Disputed) revert WrongStatus();
        if (toFulfiller > e.amount) revert AmountOutOfRange();
        _settle(id, e, Status.Resolved, toFulfiller);
    }

    /// @notice If the arbiter never rules, anyone may refund the depositor after DISPUTE_TIMEOUT.
    function refundStaleDispute(bytes32 id) external nonReentrant {
        Escrow storage e = _escrows[id];
        if (e.status != Status.Disputed) revert WrongStatus();
        if (block.timestamp < e.deadline) revert TooEarly();
        _settle(id, e, Status.Refunded, 0);
    }

    /// @dev The only place escrowed funds leave. Pays `toFulfiller` of the amount to the fulfiller, keeps the matching
    /// share of the fee, and returns everything else to the depositor. A dispute stake is held only while Disputed:
    /// on an arbiter ruling the fulfiller gets the same share of it as of the amount; otherwise it goes back.
    function _settle(bytes32 id, Escrow storage e, Status status, uint256 toFulfiller) private {
        uint256 amount = e.amount;
        uint256 fee = e.fee;
        address token = e.token;
        uint256 bond = e.status == Status.Disputed ? e.bond : 0;
        uint256 feeKept = (fee * toFulfiller) / amount;
        uint256 bondToFulfiller = status == Status.Resolved ? (bond * toFulfiller) / amount : 0;
        uint256 fulfillerTotal = toFulfiller + bondToFulfiller;
        uint256 depositorTotal = (amount - toFulfiller) + (fee - feeKept) + (bond - bondToFulfiller);

        e.status = status;
        totalLocked[token] -= amount + fee + bond;
        if (feeKept != 0) accruedFees[token] += feeKept;
        emit Settled(id, status, fulfillerTotal, depositorTotal, feeKept, bondToFulfiller);

        if (fulfillerTotal != 0) IERC20(token).safeTransfer(e.fulfiller, fulfillerTotal);
        if (depositorTotal != 0) IERC20(token).safeTransfer(e.depositor, depositorTotal);
    }

    // ────────────────────────────── fees ─────────────────────────────

    /// @notice Sends earned fees to the treasury and the dispute reserve. Destinations are fixed, so anyone may call.
    function withdrawFees(address token) external nonReentrant {
        uint256 amount = accruedFees[token];
        if (amount == 0) revert NothingToWithdraw();
        accruedFees[token] = 0;
        uint256 toReserve = (amount * reserveShareBps) / BPS;
        uint256 toTreasury = amount - toReserve;
        emit FeesWithdrawn(token, toTreasury, toReserve);
        if (toTreasury != 0) IERC20(token).safeTransfer(treasury, toTreasury);
        if (toReserve != 0) IERC20(token).safeTransfer(reserve, toReserve);
    }

    /// @notice Recovers tokens sent to the contract by mistake. Escrowed funds and earned fees are never included.
    function sweepExcess(address token, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 excess = IERC20(token).balanceOf(address(this)) - totalLocked[token] - accruedFees[token];
        if (excess == 0) revert NothingToWithdraw();
        emit ExcessSwept(token, to, excess);
        IERC20(token).safeTransfer(to, excess);
    }

    // ───────────────────────────── admin ─────────────────────────────

    /// @notice Stops new deposits only. Every way out of an escrow keeps working while paused.
    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setArbiter(address arbiter_) external onlyOwner {
        _setArbiter(arbiter_);
    }

    function setGuardian(address guardian_) external onlyOwner {
        _setGuardian(guardian_);
    }

    function setFeeRecipients(address treasury_, address reserve_) external onlyOwner {
        _setFeeRecipients(treasury_, reserve_);
    }

    /// @notice Applies to deposits made after the call.
    function setFee(uint16 feeBps_, uint16 reserveShareBps_) external onlyOwner {
        _setFee(feeBps_, reserveShareBps_);
    }

    /// @notice Applies to deposits made after the call.
    function setWindows(uint32 reviewWindow_, uint32 fulfillWindow_) external onlyOwner {
        _setWindows(reviewWindow_, fulfillWindow_);
    }

    /// @notice Allow or disallow a token for new deposits and set its limits.
    /// `disputeBond` applies to deposits made after the call.
    function setToken(
        address token,
        bool enabled,
        uint128 minAmount,
        uint128 maxAmount,
        uint256 cap,
        uint128 disputeBond
    ) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (enabled && (token.code.length == 0 || maxAmount == 0 || minAmount > maxAmount)) {
            revert InvalidTokenConfig();
        }
        tokenConfig[token] = TokenConfig(enabled, minAmount, maxAmount, cap, disputeBond);
        emit TokenConfigured(token, enabled, minAmount, maxAmount, cap, disputeBond);
    }

    /// @dev Ownership can be handed over (two steps) but never dropped.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    function _setArbiter(address arbiter_) private {
        if (arbiter_ == address(0)) revert ZeroAddress();
        arbiter = arbiter_;
        emit ArbiterUpdated(arbiter_);
    }

    function _setGuardian(address guardian_) private {
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        emit GuardianUpdated(guardian_);
    }

    function _setFeeRecipients(address treasury_, address reserve_) private {
        if (treasury_ == address(0) || reserve_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        reserve = reserve_;
        emit FeeRecipientsUpdated(treasury_, reserve_);
    }

    function _setFee(uint16 feeBps_, uint16 reserveShareBps_) private {
        if (feeBps_ > MAX_FEE_BPS || reserveShareBps_ > BPS) revert InvalidFee();
        feeBps = feeBps_;
        reserveShareBps = reserveShareBps_;
        emit FeeUpdated(feeBps_, reserveShareBps_);
    }

    function _setWindows(uint32 reviewWindow_, uint32 fulfillWindow_) private {
        if (
            reviewWindow_ < MIN_REVIEW_WINDOW || reviewWindow_ > MAX_REVIEW_WINDOW
                || fulfillWindow_ < MIN_FULFILL_WINDOW || fulfillWindow_ > MAX_FULFILL_WINDOW
        ) revert InvalidWindow();
        reviewWindow = reviewWindow_;
        fulfillWindow = fulfillWindow_;
        emit WindowsUpdated(reviewWindow_, fulfillWindow_);
    }
}
