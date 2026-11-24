import { Link } from "react-router-dom";
import { Page, PageHead } from "../components/ui";

const ROLES = [
    {
        name: "Donor",
        who: "Anyone who wants to give.",
        steps: [
            "Sign up as a donor and link your MetaMask wallet.",
            "Pick a campaign and donate mUSDC (test dollars). The money goes into the vault contract.",
            "Follow every payment made from your campaign, with the evidence.",
            "If the campaign closes, claim back your share of unspent money.",
        ],
    },
    {
        name: "NGO",
        who: "A registered charity that runs campaigns.",
        steps: [
            "Sign up as an NGO with your organisation's details. The GiveChain admin reviews your application.",
            "Once approved (the NGO role is granted on the blockchain), create campaigns.",
            "Select beneficiaries from people who applied, or add people directly.",
            "Request payments for a beneficiary, with evidence such as receipts. After a verifier approves, release the payment.",
        ],
    },
    {
        name: "Verifier",
        who: "An independent auditor who checks the NGO's work.",
        steps: [
            "Sign up as a verifier. The admin reviews your application and grants the verifier role on-chain.",
            "Approve or revoke people the NGO registered, after checking their details.",
            "Open each payment's evidence, then approve (money is reserved) or reject it.",
            "You can never approve your own campaign or a payment to yourself.",
        ],
    },
    {
        name: "Beneficiary",
        who: "A person who receives help.",
        steps: [
            "Sign up as a beneficiary and link your wallet, so payments can reach you.",
            "Apply for help on a campaign. Your ID number is only seen by the NGO and verifiers, never published.",
            "After the NGO selects you and a verifier approves you, payments arrive directly in your wallet.",
            "Confirm each payment you received.",
        ],
    },
    {
        name: "Admin",
        who: "The GiveChain operator.",
        steps: [
            "Reviews NGO and verifier applications and grants or removes their roles on the blockchain.",
            "Can pause the whole system in an emergency.",
            "Cannot move any money or approve any payment.",
        ],
    },
];

export default function HowItWorks() {
    return (
        <Page>
            <PageHead
                title="How GiveChain works"
                subtitle="Each person has their own account. Every action that involves money is signed with their own wallet and checked by the smart contracts."
            />

            <section className="card flow">
                <h2>The journey of one donation</h2>
                <ol className="flow-steps">
                    <li><strong>Donor</strong> gives 100 mUSDC to a campaign → it is locked in the vault contract.</li>
                    <li><strong>Beneficiary</strong> applies for help → the <strong>NGO</strong> selects them.</li>
                    <li><strong>Verifier</strong> checks the person and approves them.</li>
                    <li><strong>NGO</strong> requests a payment with a receipt as evidence.</li>
                    <li><strong>Verifier</strong> checks the evidence and approves → money is reserved.</li>
                    <li><strong>NGO</strong> releases → the vault pays the beneficiary's wallet directly.</li>
                    <li><strong>Beneficiary</strong> confirms receipt. Anyone can see the whole trail.</li>
                </ol>
            </section>

            <div className="role-grid">
                {ROLES.map((r) => (
                    <section className="card" key={r.name}>
                        <h2>{r.name}</h2>
                        <p className="muted">{r.who}</p>
                        <ol className="steps-list">
                            {r.steps.map((s) => (
                                <li key={s}>{s}</li>
                            ))}
                        </ol>
                    </section>
                ))}
            </div>

            <section className="card">
                <h2>What is stored where</h2>
                <ul className="steps-list">
                    <li><strong>On the blockchain:</strong> roles, campaigns, beneficiary wallets and status, every donation, approval, payment and refund.</li>
                    <li><strong>On IPFS:</strong> campaign descriptions and evidence files; the blockchain stores a fingerprint, so any change is detected.</li>
                    <li><strong>In GiveChain's account database:</strong> your name, email, hashed password and applications. It never decides who can move money.</li>
                    <li><strong>Nowhere public:</strong> beneficiaries' names and ID numbers. Only a salted fingerprint of the ID is on-chain.</li>
                </ul>
                <p>
                    <Link to="/signup" className="button">Create an account</Link>
                </p>
            </section>
        </Page>
    );
}
