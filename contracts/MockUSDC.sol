// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice A worthless test dollar token for the GiveChain demo. Never use real money.
/// @dev Uses 6 decimals like real USDC, so 1 mUSDC = 1_000_000 units.
///      Anyone can mint a limited amount to themselves through the faucet.
contract MockUSDC is ERC20 {
    /// @notice Largest amount one faucet call can mint: 10,000 mUSDC.
    uint256 public constant FAUCET_LIMIT = 10_000 * 10 ** 6;

    /// @notice The requested faucet amount was zero or above FAUCET_LIMIT.
    error InvalidFaucetAmount(uint256 requested, uint256 limit);

    constructor() ERC20("Mock USD Coin", "mUSDC") {}

    /// @notice Mints `amount` test tokens to the caller.
    /// @param amount Amount in token units (6 decimals), between 1 and FAUCET_LIMIT.
    function faucet(uint256 amount) external {
        if (amount == 0 || amount > FAUCET_LIMIT) {
            revert InvalidFaucetAmount(amount, FAUCET_LIMIT);
        }
        _mint(msg.sender, amount);
    }

    /// @notice Token decimals, matching real USDC.
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
