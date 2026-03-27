import type { ReactNode } from "react";

const TABS = ["Overview", "Clips", "Remarks", "Runs"] as const;
export type Tab = (typeof TABS)[number];

interface LayoutProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  children: ReactNode;
}

export function Layout({ activeTab, onTabChange, children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-navy text-white">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold tracking-tight">
            NC Governor's Communications Agent
          </h1>
          <p className="text-sm text-blue-200 mt-0.5">Dashboard</p>
        </div>
        <nav className="max-w-7xl mx-auto px-6 flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab
                  ? "bg-gray-50 text-navy"
                  : "text-blue-200 hover:text-white hover:bg-navy-light"
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
    </div>
  );
}
