// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract MockUSDC is ERC20 {
    mapping(address => bool) public blocked;
    constructor() ERC20("TEST ONLY USDC", "tUSDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setBlocked(address account, bool value) external { blocked[account] = value; }
    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[from] && !blocked[to], "TEST issuer blocked transfer");
        super._update(from,to,value);
    }
}
