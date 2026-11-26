// Identity commitments for beneficiaries.
//
// commitment = keccak256(abi.encodePacked(bytes32 ngoKey, string normalisedId))
//
// ngoKey is the NGO's private hashing key. It is derived from the NGO wallet's
// signature of a fixed message: the same wallet always produces the same signature
// (deterministic ECDSA, RFC 6979), so the same person always gets the same commitment
// and the contract can block duplicates. The key is never stored or sent anywhere,
// and without it nobody can guess ID numbers from the public commitments.

import { ethers } from "ethers";

const KEY_MESSAGE =
    "GiveChain beneficiary identity key (v1)\n\n" +
    "Signing this creates your organisation's private key for hashing beneficiary ID numbers.\n" +
    "It does not send a transaction or cost anything.";

const cache = new Map();

/** Asks the NGO's wallet for its identity key (one MetaMask signature per session). */
export async function ngoIdentityKey(signer) {
    const address = (await signer.getAddress()).toLowerCase();
    if (!cache.has(address)) {
        const signature = await signer.signMessage(KEY_MESSAGE);
        cache.set(address, ethers.keccak256(signature));
    }
    return cache.get(address);
}

/** "35202-1234567-1" and "35202 1234567 1" become the same ID. */
export function normaliseId(idNumber) {
    return String(idNumber).toUpperCase().replace(/[\s\-_.]/g, "");
}

export function identityCommitment(key, idNumber) {
    return ethers.solidityPackedKeccak256(["bytes32", "string"], [key, normaliseId(idNumber)]);
}
