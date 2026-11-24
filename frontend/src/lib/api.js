// Small wrapper around the GiveChain backend REST API (see backend/README.md).

async function request(path, options) {
    const res = await fetch(`/api${path}`, options);
    let body = null;
    try {
        body = await res.json();
    } catch {
        // non-JSON response
    }
    if (!res.ok) {
        throw new Error(body?.error || `Request failed (${res.status})`);
    }
    return body;
}

export const api = {
    health: () => request("/health"),
    config: () => request("/config"),
    stats: () => request("/stats"),
    campaigns: (query = "") => request(`/campaigns${query}`),
    campaign: (id) => request(`/campaigns/${id}`),
    milestones: (query = "") => request(`/milestones${query}`),
    donor: (address) => request(`/donors/${address}`),
    beneficiary: (address) => request(`/beneficiaries/${address}`),
    activity: (query = "") => request(`/activity${query}`),

    /** Uploads one evidence file to IPFS through the backend. Returns { cid, ... }. */
    uploadFile: (file) => {
        const form = new FormData();
        form.append("file", file);
        return request("/ipfs", { method: "POST", body: form });
    },

    /** Stores campaign details as JSON on IPFS. Returns { cid, ... }. */
    uploadJson: (data) =>
        request("/ipfs/json", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        }),
};

/** URL that serves an IPFS file through the backend (verified against its CID). */
export const ipfsUrl = (cid) => `/api/ipfs/${cid}`;
