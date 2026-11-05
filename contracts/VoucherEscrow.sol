// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// Immutable rules. No operator transfer, upgrade, pause or administrator seizure.
/// A signed delivery attestation is trusted evidence, not a ZK proof of redeemability.
contract VoucherEscrow is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    address public immutable validator;
    address public immutable arbitrator;
    address public immutable revenueRecipient;
    uint256 public reserveBalance;
    uint256 public constant COMPENSATION_CAP = 25e6;
    uint64 public constant DISPUTE_WINDOW = 7 days;
    bytes32 public constant DELIVERY_TYPEHASH = keccak256("Delivery(bytes32 id,bytes32 encryptedDigest,address recipient,uint64 validUntil)");
    enum State { None, Funded, Delivered, Disputed, Settled }
    struct Trade {
        address buyer; // voucher buyer, crypto seller; pays the 1% fee
        address seller; // voucher fulfiller, crypto buyer; receives principal
        uint128 principal;
        uint128 fee;
        uint64 deliverBy;
        uint64 reviewSeconds;
        uint64 reviewUntil;
        uint64 disputeUntil;
        bytes32 voucherCommitment;
        bytes32 encryptedDigest;
        State state;
    }
    mapping(bytes32 => Trade) public trades;
    mapping(address => uint256) public credits;
    event Funded(bytes32 indexed id, address indexed buyer, address indexed seller, uint256 principal, uint256 fee);
    event Delivered(bytes32 indexed id, bytes32 encryptedDigest, uint64 reviewUntil);
    event Disputed(bytes32 indexed id, uint64 disputeUntil);
    event Settled(bytes32 indexed id, uint256 sellerAmount, uint256 buyerRefund, uint256 compensation);
    error InvalidState();
    error Unauthorized();
    error InvalidTerms();
    constructor(address token_, address validator_, address arbitrator_, address revenue_) EIP712("NetPositiveVoucherEscrow", "1") {
        require(token_.code.length > 0 && IERC20Metadata(token_).decimals() == 6, "Six-decimal token required");
        require(validator_ != address(0) && arbitrator_ != address(0) && revenue_ != address(0), "Missing role");
        require(validator_ != arbitrator_, "Separate validator and arbitrator required");
        token = IERC20(token_); validator = validator_; arbitrator = arbitrator_; revenueRecipient = revenue_;
    }
    function tradeId(address buyer, bytes32 nonce) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), buyer, nonce));
    }
    function fund(bytes32 nonce, address seller, uint128 principal, uint64 deliverBy, uint64 reviewSeconds, bytes32 commitment) external nonReentrant returns (bytes32 id) {
        if (seller == address(0) || seller == msg.sender || seller == validator || seller == arbitrator || msg.sender == validator || msg.sender == arbitrator || principal < 10000 || principal > 1_000_000e6 || commitment == bytes32(0) ||
            deliverBy <= block.timestamp || deliverBy > block.timestamp + 7 days || reviewSeconds < 1 hours || reviewSeconds > 2 days) revert InvalidTerms();
        id = tradeId(msg.sender, nonce);
        if (trades[id].state != State.None) revert InvalidState();
        uint128 fee = principal / 100;
        trades[id] = Trade(msg.sender, seller, principal, fee, deliverBy, reviewSeconds, 0, 0, commitment, bytes32(0), State.Funded);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), uint256(principal) + fee);
        require(token.balanceOf(address(this)) - beforeBalance == uint256(principal) + fee, "Unsupported transfer behavior");
        emit Funded(id, msg.sender, seller, principal, fee);
    }
    function deliver(bytes32 id, bytes32 encryptedDigest, uint64 validUntil, bytes calldata signature) external {
        Trade storage t = trades[id];
        if (msg.sender != t.seller) revert Unauthorized();
        if (t.state != State.Funded || block.timestamp >= t.deliverBy || block.timestamp > validUntil || encryptedDigest == bytes32(0)) revert InvalidState();
        bytes32 hash = _hashTypedDataV4(keccak256(abi.encode(DELIVERY_TYPEHASH, id, encryptedDigest, t.buyer, validUntil)));
        if (!SignatureChecker.isValidSignatureNow(validator, hash, signature)) revert Unauthorized();
        t.encryptedDigest = encryptedDigest;
        t.reviewUntil = uint64(block.timestamp) + t.reviewSeconds;
        t.state = State.Delivered;
        emit Delivered(id, encryptedDigest, t.reviewUntil);
    }
    function confirm(bytes32 id) external {
        Trade storage t = trades[id];
        if (msg.sender != t.buyer) revert Unauthorized();
        if (t.state != State.Delivered) revert InvalidState();
        _settle(id, t.principal, 0);
    }
    function releaseAfterReview(bytes32 id) external {
        Trade storage t = trades[id];
        if (t.state != State.Delivered || block.timestamp < t.reviewUntil) revert InvalidState();
        _settle(id, t.principal, 0);
    }
    function refundUndelivered(bytes32 id) external {
        Trade storage t = trades[id];
        if (t.state != State.Funded || block.timestamp < t.deliverBy) revert InvalidState();
        _settle(id, 0, 0);
    }
    function dispute(bytes32 id) external {
        Trade storage t = trades[id];
        if (msg.sender != t.buyer && msg.sender != t.seller) revert Unauthorized();
        if (t.state != State.Delivered || block.timestamp >= t.reviewUntil) revert InvalidState();
        t.state = State.Disputed;
        t.disputeUntil = uint64(block.timestamp) + DISPUTE_WINDOW;
        emit Disputed(id, t.disputeUntil);
    }
    function resolve(bytes32 id, bool paySeller, uint256 compensation) external {
        Trade storage t = trades[id];
        if (msg.sender != arbitrator) revert Unauthorized();
        if (t.state != State.Disputed || block.timestamp >= t.disputeUntil) revert InvalidState();
        if (!paySeller && compensation != 0) revert InvalidTerms();
        _settle(id, paySeller ? t.principal : 0, compensation);
    }
    /// Explicit, immutable 50/50 principal split if arbitration disappears.
    /// This is a liveness tradeoff, not fair exchange or proof of voucher truth.
    function settleStalledDispute(bytes32 id) external {
        Trade storage t = trades[id];
        if (t.state != State.Disputed || block.timestamp < t.disputeUntil) revert InvalidState();
        _settle(id, t.principal / 2, 0);
    }
    function _settle(bytes32 id, uint256 sellerAmount, uint256 compensation) private {
        Trade storage t = trades[id];
        if (compensation > reserveBalance || compensation > COMPENSATION_CAP || compensation > t.principal) revert InvalidTerms();
        t.state = State.Settled;
        uint256 chargedFee = uint256(t.fee) * sellerAmount / t.principal;
        uint256 reserveFee = chargedFee * 30 / 100;
        reserveBalance = reserveBalance + reserveFee - compensation;
        credits[revenueRecipient] += chargedFee - reserveFee;
        credits[t.seller] += sellerAmount;
        uint256 refund = uint256(t.principal) - sellerAmount + t.fee - chargedFee;
        credits[t.buyer] += refund + compensation;
        emit Settled(id, sellerAmount, refund, compensation);
    }
    function withdraw() external nonReentrant {
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert InvalidState();
        credits[msg.sender] = 0;
        token.safeTransfer(msg.sender, amount);
    }
}
