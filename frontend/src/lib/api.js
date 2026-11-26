// Wrapper around the GiveChain backend REST API (see backend/README.md).
// The session cookie is HttpOnly and same-origin, so the browser sends it automatically.

async function request(path, { method = "GET", body, form } = {}) {
    const options = { method, credentials: "same-origin", headers: {} };
    if (form) {
        options.body = form;
    } else if (body !== undefined) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
    }
    const res = await fetch(`/api${path}`, options);
    let data = null;
    try {
        data = await res.json();
    } catch {
        // empty or non-JSON response
    }
    if (!res.ok) {
        const err = new Error(data?.error || `Request failed (${res.status})`);
        err.status = res.status;
        throw err;
    }
    return data;
}

const post = (path, body) => request(path, { method: "POST", body: body ?? {} });

export const api = {
    // Public blockchain index
    health: () => request("/health"),
    config: () => request("/config"),
    stats: () => request("/stats"),
    campaigns: (query = "") => request(`/campaigns${query}`),
    campaign: (id) => request(`/campaigns/${id}`),
    milestones: (query = "") => request(`/milestones${query}`),
    donor: (address) => request(`/donors/${address}`),
    beneficiary: (address) => request(`/beneficiaries/${address}`),
    activity: (query = "") => request(`/activity${query}`),
    profiles: () => request("/profiles"),

    // Accounts
    me: () => request("/auth/me"),
    signup: (data) => post("/auth/signup", data),
    login: (email, password) => post("/auth/login", { email, password }),
    logout: () => post("/auth/logout"),
    updateProfile: (data) => request("/auth/profile", { method: "PATCH", body: data }),
    changePassword: (currentPassword, newPassword) => post("/auth/password", { currentPassword, newPassword }),
    walletChallenge: () => post("/auth/wallet/challenge"),
    linkWallet: (address, signature) => post("/auth/wallet/link", { address, signature }),
    resubmitRoleApplication: (organisation) => post("/auth/role-application", organisation),

    // Admin
    roleApplications: (status) => request(`/admin/role-applications${status ? `?status=${status}` : ""}`),
    rejectRoleApplication: (id, note) => post(`/admin/role-applications/${id}/reject`, { note }),
    users: () => request("/admin/users"),

    // Beneficiary applications
    applyToCampaign: (campaignId, data) => post(`/campaigns/${campaignId}/applications`, data),
    campaignApplications: (campaignId) => request(`/campaigns/${campaignId}/applications`),
    myApplications: () => request("/my/applications"),
    declineApplication: (id, note) => post(`/beneficiary-applications/${id}/decline`, { note }),

    // IPFS (requires login)
    uploadFile: (file) => {
        const form = new FormData();
        form.append("file", file);
        return request("/ipfs", { method: "POST", form });
    },
    uploadJson: (data) => post("/ipfs/json", data),
};

/** URL that serves an IPFS file through the backend (verified against its CID). */
export const ipfsUrl = (cid) => `/api/ipfs/${cid}`;
