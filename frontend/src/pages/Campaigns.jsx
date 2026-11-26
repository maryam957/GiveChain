import { useState } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/useData";
import { Empty, ErrorNote, Loading, Page, PageHead } from "../components/ui";
import { CampaignCard } from "./Home";

const FILTERS = ["Active", "Completed", "Cancelled", "All"];

export default function Campaigns() {
    const [filter, setFilter] = useState("Active");
    const [search, setSearch] = useState("");
    const { data, error, loading } = useData(() => api.campaigns(filter === "All" ? "" : `?status=${filter}`), [filter]);

    const term = search.trim().toLowerCase();
    const shown = (data || []).filter(
        (c) =>
            !term ||
            [c.metadata?.title, c.metadata?.summary, c.metadata?.category, c.metadata?.location, c.metadata?.organisation]
                .filter(Boolean)
                .some((t) => t.toLowerCase().includes(term))
    );

    return (
        <Page>
            <PageHead title="Campaigns" subtitle="Every campaign is run by an NGO approved on the blockchain." />
            <div className="toolbar">
                <div className="segmented">
                    {FILTERS.map((f) => (
                        <button key={f} type="button" className={f === filter ? "active" : ""} onClick={() => setFilter(f)}>
                            {f}
                        </button>
                    ))}
                </div>
                <input
                    className="search"
                    placeholder="Search by name, category or place"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>
            {loading && !data && <Loading />}
            <ErrorNote error={error} />
            {data && shown.length === 0 && <Empty>No campaigns match.</Empty>}
            <div className="campaign-grid">
                {shown.map((c) => (
                    <CampaignCard key={c.id} c={c} />
                ))}
            </div>
        </Page>
    );
}
