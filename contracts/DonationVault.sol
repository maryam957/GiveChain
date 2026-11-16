
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AccessControlBase.sol";

contract DonationVault is AccessControlBase {

    mapping(address => uint256) public donorBalance;

    uint256 public totalDonated;
    uint256 public totalRefunded;
    uint256 public totalReleased;
    uint256 public totalCommitted;

    event DonationReceived(address indexed donor, uint256 amount);
    event RefundIssued(address indexed donor, uint256 amount);
    event FundsReserved(uint256 amount);
    event FundsReleased(address indexed beneficiary, uint256 amount);

    // Receive ETH sent directly to the contract
    receive() external payable whenNotPaused {
        _recordDonation();
    }

    // Allow donors to deposit ETH through this function
    function deposit() external payable whenNotPaused {
        _recordDonation();
    }

    // Internal function to record donations
    function _recordDonation() internal {
        require(msg.value > 0, "Donation must be greater than zero");

        donorBalance[msg.sender] += msg.value;
        totalDonated += msg.value;

        emit DonationReceived(msg.sender, msg.value);
    }

    // Allow donors to request refunds
    function refund(uint256 amount)
        external
        whenNotPaused
        nonReentrant
    {
        require(amount > 0, "Amount must be greater than zero");
        require(donorBalance[msg.sender] >= amount, "Insufficient donor balance");

        uint256 available = address(this).balance - totalCommitted;
        require(available >= amount, "Insufficient uncommitted funds");

        // Update state before transferring ETH
        donorBalance[msg.sender] -= amount;
        totalRefunded += amount;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Refund transfer failed");

        emit RefundIssued(msg.sender, amount);
    }

    // Reserve funds for an approved milestone
    function reserveFunds(uint256 amount)
        external
        onlyRole(MILESTONE_ROLE)
        whenNotPaused
    {
        require(amount > 0, "Amount must be greater than zero");

        uint256 available = address(this).balance - totalCommitted;
        require(available >= amount, "Insufficient vault funds");

        totalCommitted += amount;

        emit FundsReserved(amount);
    }

    // Release reserved funds to a beneficiary
    function releaseTo(address payable beneficiary, uint256 amount)
        external
        onlyRole(DISBURSEMENT_ROLE)
        whenNotPaused
        nonReentrant
    {
        require(beneficiary != address(0), "Invalid beneficiary");
        require(amount > 0, "Amount must be greater than zero");
        require(totalCommitted >= amount, "Insufficient committed funds");

        // Update state before transferring ETH
        totalCommitted -= amount;
        totalReleased += amount;

        (bool success, ) = beneficiary.call{value: amount}("");
        require(success, "Fund transfer failed");

        emit FundsReleased(beneficiary, amount);
    }

    // View the amount available for new commitments or refunds
    function getAvailableBalance() external view returns (uint256) {
        return address(this).balance - totalCommitted;
    }
}
