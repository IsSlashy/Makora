'use client';

import { Header } from '@/components/Header';
import { TheWheel } from '@/components/TheWheel';
import { PortfolioCard } from '@/components/PortfolioCard';
import { StrategyPanel } from '@/components/StrategyPanel';
import { ActivityFeed } from '@/components/ActivityFeed';
import { RiskControls } from '@/components/RiskControls';

export default function Home() {
  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-6 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Main OODA Wheel - takes center stage */}
          <div className="lg:col-span-2 lg:row-span-2">
            <TheWheel />
          </div>

          {/* Portfolio Card - top right */}
          <div>
            <PortfolioCard />
          </div>

          {/* Strategy Panel - middle right */}
          <div>
            <StrategyPanel />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Activity Feed - bottom left */}
          <div>
            <ActivityFeed />
          </div>

          {/* Risk Controls - bottom right */}
          <div>
            <RiskControls />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-accent/20 mt-12">
        <div className="container mx-auto px-6 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-text-secondary">
            <div>
              Built with ❤️ for Solana Agent Hackathon 2026
            </div>
            <div className="flex items-center gap-6">
              <a href="https://github.com/IsSlashy/Makora" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">GitHub</a>
              <a href="https://x.com/Protocol01_" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">Twitter</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
