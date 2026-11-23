// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract GasCustomErrors {
    error ZeroDonation();

    function deposit() external payable {
        if (msg.value == 0) revert ZeroDonation();
    }
}
