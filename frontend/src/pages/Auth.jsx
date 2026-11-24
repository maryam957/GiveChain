import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function Login() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            await login(email, password);
            // Return to a public page the user came from (e.g. a campaign they wanted to
            // donate to); portal pages may belong to a previous user's role, so go home.
            const from = location.state?.from;
            navigate(from && !from.startsWith("/app") ? from : "/app", { replace: true });
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <main className="auth-page">
            <form className="auth-card" onSubmit={submit}>
                <h1>Log in</h1>
                <p className="muted">Welcome back to GiveChain.</p>
                <label>
                    Email
                    <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <label>
                    Password
                    <input
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </label>
                {error && <p className="error-note">{error}</p>}
                <button className="button full large" disabled={busy}>
                    {busy ? "Logging in…" : "Log in"}
                </button>
                <p className="small muted center">
                    New to GiveChain? <Link to="/signup">Create an account</Link>
                </p>
            </form>
        </main>
    );
}

const TYPES = [
    {
        key: "donor",
        title: "Donor",
        text: "I want to give to campaigns and track where my money goes.",
    },
    {
        key: "beneficiary",
        title: "Beneficiary",
        text: "I need help and want to apply to a campaign.",
    },
    {
        key: "ngo",
        title: "NGO",
        text: "My organisation wants to run campaigns. Needs admin approval.",
    },
    {
        key: "verifier",
        title: "Verifier",
        text: "I am an independent auditor who checks people and payments. Needs admin approval.",
    },
];

export function Signup() {
    const { signup } = useAuth();
    const navigate = useNavigate();
    const [type, setType] = useState(null);
    const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", phone: "" });
    const [org, setOrg] = useState({ organisationName: "", registrationNumber: "", country: "", website: "", description: "" });
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
    const setO = (field) => (e) => setOrg({ ...org, [field]: e.target.value });
    const needsOrg = type === "ngo" || type === "verifier";

    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        if (form.password !== form.confirm) return setError("The two passwords do not match.");
        setBusy(true);
        try {
            await signup({
                accountType: type,
                name: form.name,
                email: form.email,
                password: form.password,
                phone: form.phone,
                organisation: needsOrg ? org : undefined,
            });
            navigate("/app", { replace: true });
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    if (!type) {
        return (
            <main className="auth-page">
                <div className="auth-card wide">
                    <h1>Create your account</h1>
                    <p className="muted">How will you use GiveChain?</p>
                    <div className="type-grid">
                        {TYPES.map((t) => (
                            <button type="button" key={t.key} className="type-card" onClick={() => setType(t.key)}>
                                <strong>{t.title}</strong>
                                <span>{t.text}</span>
                            </button>
                        ))}
                    </div>
                    <p className="small muted center">
                        Already have an account? <Link to="/login">Log in</Link>
                    </p>
                </div>
            </main>
        );
    }

    const title = TYPES.find((t) => t.key === type).title;
    return (
        <main className="auth-page">
            <form className="auth-card wide" onSubmit={submit}>
                <button type="button" className="link-button back" onClick={() => setType(null)}>
                    ← Change account type
                </button>
                <h1>Sign up as {title === "NGO" ? "an NGO" : `a ${title.toLowerCase()}`}</h1>
                <h3>Your details</h3>
                <div className="grid-2 tight">
                    <label>
                        Full name
                        <input value={form.name} onChange={set("name")} autoComplete="name" required minLength={2} maxLength={80} />
                    </label>
                    <label>
                        Email
                        <input type="email" value={form.email} onChange={set("email")} autoComplete="email" required />
                    </label>
                    <label>
                        Password
                        <input
                            type="password"
                            value={form.password}
                            onChange={set("password")}
                            autoComplete="new-password"
                            required
                            minLength={8}
                        />
                        <span className="hint">At least 8 characters, with letters and numbers.</span>
                    </label>
                    <label>
                        Repeat password
                        <input type="password" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" required />
                    </label>
                    <label>
                        Phone (optional)
                        <input value={form.phone} onChange={set("phone")} autoComplete="tel" maxLength={30} />
                    </label>
                </div>

                {needsOrg && (
                    <>
                        <h3>Your organisation</h3>
                        <p className="small muted">The GiveChain admin checks these details before approving your account.</p>
                        <div className="grid-2 tight">
                            <label>
                                Organisation name
                                <input value={org.organisationName} onChange={setO("organisationName")} required minLength={2} maxLength={120} />
                            </label>
                            <label>
                                Registration number {type === "verifier" && "(optional)"}
                                <input
                                    value={org.registrationNumber}
                                    onChange={setO("registrationNumber")}
                                    required={type === "ngo"}
                                    maxLength={60}
                                />
                            </label>
                            <label>
                                Country
                                <input value={org.country} onChange={setO("country")} maxLength={60} />
                            </label>
                            <label>
                                Website (optional)
                                <input value={org.website} onChange={setO("website")} maxLength={200} />
                            </label>
                        </div>
                        <label>
                            What does your organisation do?
                            <textarea value={org.description} onChange={setO("description")} rows={3} required minLength={10} maxLength={1000} />
                        </label>
                    </>
                )}

                <p className="small muted">
                    After signing up you will link your MetaMask wallet. Every action involving money is signed by that wallet.
                </p>
                {error && <p className="error-note">{error}</p>}
                <button className="button full large" disabled={busy}>
                    {busy ? "Creating account…" : "Create account"}
                </button>
            </form>
        </main>
    );
}
