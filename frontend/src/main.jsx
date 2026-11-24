import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Web3Provider } from "./context/Web3Context";
import { TxProvider } from "./context/TxContext";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Campaign from "./pages/Campaign";
import Dashboard from "./pages/Dashboard";
import Transparency from "./pages/Transparency";
import "./styles.css";

function NotFound() {
    return (
        <div className="card center">
            <h1>Page not found</h1>
        </div>
    );
}

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Web3Provider>
                <TxProvider>
                    <Routes>
                        <Route element={<Layout />}>
                            <Route path="/" element={<Home />} />
                            <Route path="/campaigns/:id" element={<Campaign />} />
                            <Route path="/dashboard" element={<Dashboard />} />
                            <Route path="/transparency" element={<Transparency />} />
                            <Route path="*" element={<NotFound />} />
                        </Route>
                    </Routes>
                </TxProvider>
            </Web3Provider>
        </BrowserRouter>
    </React.StrictMode>
);
