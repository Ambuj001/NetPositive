// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VoucherEscrow
/// @notice ERC-20-only voucher escrow intended for Arc testnet (chain ID 5042002).
/// @dev Arc USDC's ERC-20 address is 0x3600000000000000000000000000000000000000.
/// In the ERC-20 view, 1 USDC = 1_000_000 base units (6 decimals).
/// Native value uses a different scale (18 decimals) for the same asset and is
/// rejected. Fund this contract only through deposit's ERC-20 transferFrom.
/// Configuration is immutable except for the owner's ability to replace the operator.
contract VoucherEscrow {
    enum Status { None, Funded, Released, Refunded }

    struct Escrow {
        address depositor;
        uint256 amount;
        Status status;
    }

    mapping(bytes32 => Escrow) public escrows;
    mapping(bytes32 => uint256) public claimableAt;

    address public immutable usdc;
    address public immutable treasury;
    address public immutable rewardsPool;
    uint256 public immutable feeBps;
    uint256 public immutable feeToRewardsBps;
    uint256 public immutable claimDelay;

    address public operator;
    address public owner;

    uint256 private _guard = 1;

    error ZeroAddress();
    error InvalidFeeBps();
    error InvalidFeeToRewardsBps();
    error InvalidClaimDelay();
    error UnauthorizedOwner();
    error UnauthorizedOperator();
    error ReentrantCall();
    error IdAlreadyUsed();
    error ZeroAmount();
    error NotFunded();
    error TooEarly();
    error NativeValueRejected();
    error TokenHasNoCode();
    error TokenTransferFailed();

    event Deposited(bytes32 indexed id, address indexed depositor, uint256 amount, uint256 claimableAt);
    event Released(bytes32 indexed id, address indexed to, uint256 payout, uint256 toTreasury, uint256 toRewards);
    event Refunded(bytes32 indexed id, address indexed depositor, uint256 amount);
    event ClaimedAfterTimeout(bytes32 indexed id, address indexed depositor, uint256 amount);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);

    modifier onlyOwner() {
        if (msg.sender != owner) revert UnauthorizedOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert UnauthorizedOperator();
        _;
    }

    modifier nonReentrant() {
        if (_guard != 1) revert ReentrantCall();
        _guard = 2;
        _;
        _guard = 1;
    }

    /// @param usdc_ ERC-20 token address, not the native-value interface.
    /// @param operator_ Account permitted to release or refund funded escrows.
    /// @param owner_ Account permitted only to replace the operator.
    /// @param treasury_ Treasury fee recipient; required when fees are enabled.
    /// @param rewardsPool_ Rewards fee recipient; required when fees are enabled.
    /// @param feeBps_ Release fee in basis points, at most 1,000.
    /// @param feeToRewardsBps_ Rewards share of the fee, at most 10,000.
    /// @param claimDelay_ Timeout in seconds, from one hour through 30 days.
    constructor(
        address usdc_,
        address operator_,
        address owner_,
        address treasury_,
        address rewardsPool_,
        uint256 feeBps_,
        uint256 feeToRewardsBps_,
        uint256 claimDelay_
    ) {
        if (usdc_ == address(0) || operator_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }
        if (feeBps_ > 1_000) revert InvalidFeeBps();
        if (feeToRewardsBps_ > 10_000) revert InvalidFeeToRewardsBps();
        if (claimDelay_ < 1 hours || claimDelay_ > 30 days) revert InvalidClaimDelay();
        if (feeBps_ > 0 && (treasury_ == address(0) || rewardsPool_ == address(0))) {
            revert ZeroAddress();
        }
        usdc = usdc_;
        operator = operator_;
        owner = owner_;
        treasury = treasury_;
        rewardsPool = rewardsPool_;
        feeBps = feeBps_;
        feeToRewardsBps = feeToRewardsBps_;
        claimDelay = claimDelay_;
    }

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        address oldOperator = operator;
        operator = newOperator;
        emit OperatorUpdated(oldOperator, newOperator);
    }

    /// @notice Deposit amount in 6-decimal ERC-20 base units; no native value is accepted.
    function deposit(bytes32 id, uint256 amount) external nonReentrant {
        if (escrows[id].status != Status.None) revert IdAlreadyUsed();
        if (amount == 0) revert ZeroAmount();
        if (msg.sender == address(0)) revert ZeroAddress();

        uint256 deadline = block.timestamp + claimDelay;
        escrows[id] = Escrow(msg.sender, amount, Status.Funded);
        claimableAt[id] = deadline;
        emit Deposited(id, msg.sender, amount, deadline);

        uint256 balanceBefore = _balanceOf(address(this));
        _safeTransferFrom(msg.sender, address(this), amount);
        // Reject fee-on-transfer or otherwise short-paying tokens: the escrow must hold exactly `amount`.
        if (_balanceOf(address(this)) - balanceBefore != amount) revert TokenTransferFailed();
    }

    function _balanceOf(address account) private view returns (uint256 bal) {
        address token = usdc;
        if (token.code.length == 0) revert TokenHasNoCode();
        (bool success, bytes memory result) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", account));
        if (!success || result.length < 32) revert TokenTransferFailed();
        bal = abi.decode(result, (uint256));
    }

    function release(bytes32 id, address to) external onlyOperator nonReentrant {
        Escrow storage escrow = escrows[id];
        if (escrow.status != Status.Funded) revert NotFunded();
        if (to == address(0)) revert ZeroAddress();

        uint256 amount = escrow.amount;
        escrow.status = Status.Released;
        escrow.amount = 0;

        if (feeBps == 0) {
            _safeTransfer(to, amount);
            emit Released(id, to, amount, 0, 0);
            return;
        }

        uint256 fee = _basisPoints(amount, feeBps);
        uint256 toRewards = _basisPoints(fee, feeToRewardsBps);
        uint256 toTreasury = _basisPoints(fee, 10_000 - feeToRewardsBps);
        uint256 payout = amount - toTreasury - toRewards;

        if (payout != 0) _safeTransfer(to, payout);
        if (toTreasury != 0) _safeTransfer(treasury, toTreasury);
        if (toRewards != 0) _safeTransfer(rewardsPool, toRewards);
        emit Released(id, to, payout, toTreasury, toRewards);
    }

    function refund(bytes32 id) external onlyOperator nonReentrant {
        Escrow storage escrow = escrows[id];
        if (escrow.status != Status.Funded) revert NotFunded();

        address depositor = escrow.depositor;
        uint256 amount = escrow.amount;
        escrow.status = Status.Refunded;
        escrow.amount = 0;

        _safeTransfer(depositor, amount);
        emit Refunded(id, depositor, amount);
    }

    /// @notice Anyone may trigger a full refund to the depositor after the deadline.
    function claimAfterTimeout(bytes32 id) external nonReentrant {
        Escrow storage escrow = escrows[id];
        if (escrow.status != Status.Funded) revert NotFunded();
        if (block.timestamp < claimableAt[id]) revert TooEarly();

        address depositor = escrow.depositor;
        uint256 amount = escrow.amount;
        escrow.status = Status.Refunded;
        escrow.amount = 0;

        _safeTransfer(depositor, amount);
        emit ClaimedAfterTimeout(id, depositor, amount);
    }

    /// @dev Equivalent to floor(amount * bps / 10_000), without product overflow.
    /// All callers supply bps <= 10_000.
    function _basisPoints(uint256 amount, uint256 bps) private pure returns (uint256) {
        return (amount / 10_000) * bps + ((amount % 10_000) * bps) / 10_000;
    }

    function _safeTransfer(address to, uint256 amount) private {
        _callToken(abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), to, amount));
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        _callToken(abi.encodeWithSelector(bytes4(keccak256("transferFrom(address,address,uint256)")), from, to, amount));
    }

    /// @dev Require contract code, a successful call, and either no return data or
    /// an ABI-encoded true. Malformed bool data also uses a custom error.
    function _callToken(bytes memory data) private {
        address token = usdc;
        if (token.code.length == 0) revert TokenHasNoCode();
        (bool success, bytes memory result) = token.call(data);
        if (!success) revert TokenTransferFailed();
        if (result.length != 0) {
            if (result.length < 32) revert TokenTransferFailed();
            uint256 returnedValue;
            assembly ("memory-safe") {
                returnedValue := mload(add(result, 32))
            }
            if (returnedValue != 1) revert TokenTransferFailed();
        }
    }

    receive() external payable {
        revert NativeValueRejected();
    }

    fallback() external payable {
        revert NativeValueRejected();
    }
}
