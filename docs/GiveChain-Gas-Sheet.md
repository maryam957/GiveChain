# GiveChain Gas Measurement Sheet

## Test Conditions

- Hardhat local test network
- Solidity 0.8.28
- Optimizer enabled with 200 runs
- Identical Hardhat configuration for each benchmark pair
- Custom-error pair: same zero-value `deposit()` call
- Storage pair: same account, vault state, 1 ETH deposit, beneficiary, and
  `approveMilestone(1)` input
- Each measurement was read from the transaction receipt's `gasUsed`

## Measurements

| Benchmark | Before | After | Change |
|---|---:|---:|---:|
| Custom-error revert (`deposit({ value: 0 })`) | 21,303 gas | 21,225 gas | -78 gas |
| Milestone storage caching (`approveMilestone`) | 104,560 gas | 104,397 gas | -163 gas |

The custom-error comparison used minimal purpose-built contracts with equivalent
zero-value revert conditions under the same Hardhat compiler settings. It
measured a 78-gas saving on this revert path. It does not establish savings on
successful transactions.

The storage-caching result came from two purpose-built contracts that differed
only in whether milestone fields were cached locally. Both used the same
Hardhat config, account, vault state, deposit value, beneficiary, and
`approveMilestone(1)` input.

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

The storage-caching benchmark contracts are in
`contracts/GasMilestoneStorageBaseline.sol` and
`contracts/GasMilestoneStorageAfter.sol`. Run the benchmark test to reproduce
the measurements.

## Security/Correctness Tradeoff

The accounting fix adds one storage write on donations and two write operations
around reservation/refund state transitions. This is accepted because the
additional gas prevents over-refunds and makes pooled-fund accounting explicit.
