// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract GasCustomRequire {
    function deposit() external payable {
        require(msg.value > 0, "Donation must be greater than zero");
    }
}
