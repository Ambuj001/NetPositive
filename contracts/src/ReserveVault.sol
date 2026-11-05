// SPDX-License-Identifier: MIT
// AI-assisted: Codex. See AI_USAGE.md.
pragma solidity ^0.8.28;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ReserveVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable usdc;
    uint256 public immutable maxPayoutPerOrder;
    uint256 public immutable maxPayoutPerDay;
    address public escrow;
    mapping(bytes32 => uint256) public paidForOrder;
    mapping(uint256 => uint256) public paidForDay;
    event EscrowBound(address indexed escrow);
    event Paid(bytes32 indexed orderId, uint256 amount, uint256 unmetRequest);

    constructor(address owner_, IERC20 token, uint256 perOrder, uint256 perDay) Ownable(owner_) {
        require(address(token).code.length > 0 && perOrder > 0 && perDay >= perOrder, "Invalid reserve");
        usdc = token;
        maxPayoutPerOrder = perOrder;
        maxPayoutPerDay = perDay;
    }

    function bindEscrow(address escrow_) external onlyOwner {
        require(escrow == address(0) && escrow_.code.length > 0, "Escrow already bound or absent");
        escrow = escrow_;
        emit EscrowBound(escrow_);
    }

    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// Only transfers to the bound escrow, which credits the order's fixed beneficiary.
    function payout(bytes32 id, uint256 requested) external nonReentrant returns (uint256 paid) {
        require(msg.sender == escrow, "Only escrow");
        uint256 day = block.timestamp / 1 days;
        paid = requested;
        uint256 cap = maxPayoutPerOrder - paidForOrder[id];
        if (paid > cap) paid = cap;
        cap = maxPayoutPerDay - paidForDay[day];
        if (paid > cap) paid = cap;
        cap = usdc.balanceOf(address(this));
        if (paid > cap) paid = cap;
        paidForOrder[id] += paid;
        paidForDay[day] += paid;
        if (paid > 0) usdc.safeTransfer(escrow, paid);
        emit Paid(id, paid, requested - paid);
    }
}
