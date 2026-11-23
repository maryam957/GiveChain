
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AccessControlBase.sol";

contract DonationVault is AccessControlBase {
    error ZeroDonation();
    error ZeroRefund();
    error InsufficientDonorBalance();
    error InsufficientUncommittedFunds();
    error InsufficientCommittedFunds();
    error InvalidBeneficiary();
    error ZeroAmount();
    error RefundTransferFailed();
    error BeneficiaryTransferFailed();
    error RefundsClosed();

    mapping(address => uint256) public donorBalance;

    uint256 public totalDonated;
    uint256 public totalRefunded;
    uint256 public totalReleased;
    uint256 public totalCommitted;
    uint256 public totalRefundable;
    bool public refundsClosed;

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
        if (msg.value == 0) revert ZeroDonation();

        uint256 newDonorBalance = donorBalance[msg.sender] + msg.value;
        donorBalance[msg.sender] = newDonorBalance;

        unchecked {
            totalDonated += msg.value;
            totalRefundable += msg.value;
        }

        emit DonationReceived(msg.sender, msg.value);
    }

    // Allow donors to request refunds
    function refund(uint256 amount)
        external
        whenNotPaused
        nonReentrant
    {
        if (refundsClosed) revert RefundsClosed();
        if (amount == 0) revert ZeroRefund();
        if (donorBalance[msg.sender] < amount) revert InsufficientDonorBalance();
        if (totalRefundable < amount) revert InsufficientUncommittedFunds();

        // Update state before transferring ETH
        unchecked {
            donorBalance[msg.sender] -= amount;
            totalRefunded += amount;
            totalRefundable -= amount;
        }

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert RefundTransferFailed();

        emit RefundIssued(msg.sender, amount);
    }

    // Reserve funds for an approved milestone
    function reserveFunds(uint256 amount)
        external
        onlyRole(MILESTONE_ROLE)
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        if (totalRefundable < amount) revert InsufficientUncommittedFunds();

        unchecked {
            totalCommitted += amount;
            totalRefundable -= amount;
        }
        refundsClosed = true;

        emit FundsReserved(amount);
    }

    // Release reserved funds to a beneficiary
    function releaseTo(address payable beneficiary, uint256 amount)
        external
        onlyRole(DISBURSEMENT_ROLE)
        whenNotPaused
        nonReentrant
    {
        if (beneficiary == address(0)) revert InvalidBeneficiary();
        if (amount == 0) revert ZeroAmount();
        if (totalCommitted < amount) revert InsufficientCommittedFunds();

        // Update state before transferring ETH
        totalCommitted -= amount;
        totalReleased += amount;

        (bool success, ) = beneficiary.call{value: amount}("");
        if (!success) revert BeneficiaryTransferFailed();

        emit FundsReleased(beneficiary, amount);
    }

    // View the amount available for new commitments or refunds
    function getAvailableBalance() external view returns (uint256) {
        return totalRefundable;
    }
}
