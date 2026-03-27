import { useState } from "react";
import { Layout, type Tab } from "./components/layout";
import { StatsPanel } from "./components/stats-panel";
import { ClipsFeed } from "./components/clips-feed";
import { RemarksList } from "./components/remarks-list";
import { RunsHistory } from "./components/runs-history";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === "Overview" && <StatsPanel />}
      {activeTab === "Clips" && <ClipsFeed />}
      {activeTab === "Remarks" && <RemarksList />}
      {activeTab === "Runs" && <RunsHistory />}
    </Layout>
  );
}

export default App;
