// Identity commitments for beneficiaries. Computed entirely in the browser:
// the national ID number is never sent to the backend or the blockchain.
//
// commitment = keccak256(abi.encodePacked(bytes32 salt, string idNumber))
// The NGO must keep the salt with its private records; without it, nobody can link
// the on-chain commitment back to a person, and nobody can guess IDs from the hash.

import { ethers } from "ethers";

export function newSalt() {
    return ethers.hexlify(ethers.randomBytes(32));
}

export function identityCommitment(salt, idNumber) {
    return ethers.solidityPackedKeccak256(["bytes32", "string"], [salt, idNumber.trim()]);
}
