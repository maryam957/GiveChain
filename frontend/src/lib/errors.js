// Turns wallet and contract errors into short, human-readable messages.

import { ethers } from "ethers";

const FRIENDLY = {
    // Access and pause
    MissingRole: "Your wallet does not have the role needed for this action.",
    SystemPaused: "GiveChain is paused for an emergency. Try again later.",
    AccessControlUnauthorizedAccount: "Your wallet does not have the role needed for this action.",
    ConflictingRole: "One wallet cannot be both an NGO and an auditor.",
    EnforcedPause: "The system is already paused.",
    ExpectedPause: "The system is not paused.",
    // Registry
    InvalidTarget: "The funding target must be above zero.",
    EmptyMetadataCID: "Campaign details are missing.",
    CampaignNotActive: "This campaign is not active.",
    NotCampaignNgo: "Only the NGO that owns this campaign can do this.",
    NotAllowedToCancel: "Only the campaign's NGO or the admin can cancel it.",
    InvalidIdentityCommitment: "The identity commitment is empty.",
    BeneficiaryAlreadyRegistered: "This wallet is already registered in this campaign.",
    IdentityAlreadyUsed: "This person is already registered in this campaign (same ID).",
    NgoCannotBeBeneficiary: "An NGO cannot register its own wallet as a beneficiary.",
    AuditorCannotApproveSelf: "An auditor cannot approve their own wallet.",
    InvalidBeneficiaryStatus: "The beneficiary is not in the right state for this action.",
    // Vault
    ZeroAmount: "The amount must be above zero.",
    CampaignNotClosed: "Refunds open only after a campaign is completed or cancelled.",
    BeneficiaryNotEligible: "The beneficiary is not approved for this campaign (or the campaign is closed).",
    InsufficientCampaignFunds: "This campaign does not have enough available money.",
    ReservationExists: "This payment already has money reserved.",
    InvalidReservationStatus: "This payment is not in the right state.",
    NoContribution: "You did not donate to this campaign.",
    RefundAlreadyClaimed: "You already claimed your refund for this campaign.",
    NothingToRefund: "There is nothing left to refund for you.",
    NotDisbursementContract: "Only the milestone contract can move campaign money.",
    // Milestones
    EmptyEvidenceCID: "Evidence is required.",
    InvalidMilestoneStatus: "This payment request is not in the right state for this action.",
    ApproverIsCampaignNgo: "You cannot approve a campaign you own.",
    ApproverIsBeneficiary: "You cannot approve a payment to yourself.",
    NotMilestoneBeneficiary: "Only the beneficiary of this payment can confirm it.",
    // Token
    ERC20InsufficientBalance: "Your wallet does not have enough mUSDC. Use the faucet to get test tokens.",
    ERC20InsufficientAllowance: "The vault is not allowed to spend that much of your mUSDC yet.",
    InvalidFaucetAmount: "The faucet gives between 0 and 10,000 mUSDC per request.",
    ReentrancyGuardReentrantCall: "Blocked a re-entrant call.",
};

let errorInterface = null;

/** Builds one Interface containing every custom error from every contract ABI. */
export function registerErrorAbis(abis) {
    const seen = new Set();
    const fragments = [];
    for (const abi of abis) {
        for (const item of abi) {
            if (item.type !== "error") continue;
            const key = `${item.name}(${item.inputs.map((i) => i.type).join(",")})`;
            if (!seen.has(key)) {
                seen.add(key);
                fragments.push(item);
            }
        }
    }
    errorInterface = new ethers.Interface(fragments);
}

function findRevertData(err) {
    const candidates = [err?.data, err?.error?.data, err?.info?.error?.data, err?.revert?.data];
    for (const c of candidates) {
        if (typeof c === "string" && c.startsWith("0x") && c.length >= 10) return c;
        if (c && typeof c.data === "string") return c.data;
    }
    const match = /0x[0-9a-fA-F]{8,}/.exec(err?.message || "");
    return match ? match[0] : null;
}

/**
 * @returns {{ kind: "rejected"|"failed", message: string, errorName?: string }}
 */
export function describeError(err) {
    if (err?.code === "ACTION_REJECTED" || err?.code === 4001 || err?.info?.error?.code === 4001) {
        return { kind: "rejected", message: "You rejected the transaction in your wallet." };
    }
    if (err?.revert?.name) {
        return {
            kind: "failed",
            errorName: err.revert.name,
            message: FRIENDLY[err.revert.name] || `The contract refused: ${err.revert.name}.`,
        };
    }
    const data = findRevertData(err);
    if (data && errorInterface) {
        try {
            const parsed = errorInterface.parseError(data);
            if (parsed) {
                return {
                    kind: "failed",
                    errorName: parsed.name,
                    message: FRIENDLY[parsed.name] || `The contract refused: ${parsed.name}.`,
                };
            }
        } catch {
            // unknown error data
        }
    }
    if (err?.code === "INSUFFICIENT_FUNDS") {
        return { kind: "failed", message: "Your wallet has no ETH to pay the gas fee." };
    }
    return { kind: "failed", message: err?.shortMessage || err?.reason || err?.message || "Transaction failed." };
}
