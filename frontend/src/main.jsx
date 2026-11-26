import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { Web3Provider } from "./context/Web3Context";
import { AuthProvider } from "./context/AuthContext";
import { ProfilesProvider } from "./context/ProfilesContext";
import { TxProvider } from "./context/TxContext";
import Layout from "./components/Layout";
import { Page } from "./components/ui";
import Home from "./pages/Home";
import Campaigns from "./pages/Campaigns";
import Campaign from "./pages/Campaign";
import Transparency from "./pages/Transparency";
import HowItWorks from "./pages/HowItWorks";
import { Login, Signup } from "./pages/Auth";
import PortalLayout from "./pages/portal/PortalLayout";
import Overview from "./pages/portal/Overview";
import Profile from "./pages/portal/Profile";
import { AdminApplications, AdminPeople, AdminSystem } from "./pages/portal/Admin";
import { NgoCampaign, NgoCampaigns } from "./pages/portal/Ngo";
import { VerifierReview } from "./pages/portal/Verifier";
import { BeneficiaryAssistance, DonorDonations } from "./pages/portal/People";
import "./styles.css";

function NotFound() {
    return (
        <Page>
            <div className="card center">
                <h1>Page not found</h1>
                <Link to="/">Go to the home page</Link>
            </div>
        </Page>
    );
}

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Web3Provider>
                <AuthProvider>
                    <ProfilesProvider>
                        <TxProvider>
                            <Routes>
                                <Route element={<Layout />}>
                                    <Route path="/" element={<Home />} />
                                    <Route path="/campaigns" element={<Campaigns />} />
                                    <Route path="/campaigns/:id" element={<Campaign />} />
                                    <Route path="/transparency" element={<Transparency />} />
                                    <Route path="/how-it-works" element={<HowItWorks />} />
                                    <Route path="/login" element={<Login />} />
                                    <Route path="/signup" element={<Signup />} />
                                    <Route path="/app" element={<PortalLayout />}>
                                        <Route index element={<Overview />} />
                                        <Route path="profile" element={<Profile />} />
                                        <Route path="applications" element={<AdminApplications />} />
                                        <Route path="people" element={<AdminPeople />} />
                                        <Route path="system" element={<AdminSystem />} />
                                        <Route path="campaigns" element={<NgoCampaigns />} />
                                        <Route path="campaigns/:id" element={<NgoCampaign />} />
                                        <Route path="review" element={<VerifierReview />} />
                                        <Route path="donations" element={<DonorDonations />} />
                                        <Route path="assistance" element={<BeneficiaryAssistance />} />
                                    </Route>
                                    <Route path="*" element={<NotFound />} />
                                </Route>
                            </Routes>
                        </TxProvider>
                    </ProfilesProvider>
                </AuthProvider>
            </Web3Provider>
        </BrowserRouter>
    </React.StrictMode>
);
