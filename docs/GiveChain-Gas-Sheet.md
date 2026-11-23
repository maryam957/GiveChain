# GiveChain Gas Measurement Sheet

## Test Conditions

- Hardhat local test network
- Same test account set for each run
- Transaction values:
  - Donation: 1 ETH
  - Beneficiary registration: 1 wallet and identity commitment
  - Milestone creation: 1 ETH
  - Milestone approval plus vault release: 1 ETH
- Each measurement was read from the transaction receipt's `gasUsed`
- Before measurements came from the original contract implementation
- After measurements came from the accounting and optimization implementation

## Measurements

| Operation | Before | After | Change |
|---|---:|---:|---:|
| Donation | 69,335 | 91,445 | +22,110 |
| Beneficiary registration | 120,949 | 120,949 | 0 |
| Milestone creation | 158,611 | 158,611 | 0 |
| Milestone approval + release | 120,565 | 120,436 | -129 |

The donation increase is attributable to the additional `totalRefundable`
accounting write required to enforce pooled-fund refunds. It is an intentional
security cost, not a hidden bug or test discrepancy.

## Optimization 1: Custom Solidity Errors

Before: `require(..., "reason")` revert handling used ABI-encoded string
messages.

After: named custom errors are used for invalid donation, refund, amount,
balance, and transfer conditions.

This reduces revert payload size and gives tests stable, typed negative assertions.

## Optimization 2: Milestone Storage Caching

Before: `approveMilestone` repeatedly read `milestone.amount`,
`milestone.beneficiary`, and `milestone.id` from storage.

After: the milestone amount and beneficiary are copied to local variables once
before vault calls, reducing repeated storage access and making external-call
arguments consistent.

Measured result: approval plus release decreased from 120,565 to 120,436 gas,
a 129-gas reduction.

## Security/Correctness Tradeoff

The accounting fix adds one storage write on donations and two write operations
around reservation/refund state transitions. This is accepted because the
additional gas prevents over-refunds and makes pooled-fund accounting explicit.
