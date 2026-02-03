'use client';

import { Header } from '@/components/Header';
import { TheWheel } from '@/components/TheWheel';
import { PortfolioCard } from '@/components/PortfolioCard';
import { StrategyPanel } from '@/components/StrategyPanel';
import { ActivityFeed } from '@/components/ActivityFeed';
import { RiskControls } from '@/components/RiskControls';

export default function Home() {
  return (
    <div className="min-h-screen bg-bg-void">
      <Header />

      <main className="max-w-[1400px] mx-auto px-6 py-8">
        {/* Top grid: Wheel + Portfolio + Strategy */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div className="lg:col-span-2 lg:row-span-2">
            <TheWheel />
          </div>
          <div>
            <PortfolioCard />
          </div>
          <div>
            <StrategyPanel />
          </div>
        </div>

        {/* Bottom grid: Activity + Risk */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ActivityFeed />
          <RiskControls />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-cursed/8 mt-12">
        <div className="max-w-[1400px] mx-auto px-6 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-[10px] font-mono text-text-muted tracking-wider">
              MAKORA v0.1 — Built for Solana Agent Hackathon 2026
            </div>
            <div className="flex items-center gap-6 text-[10px] font-mono text-text-muted tracking-wider">
              <a href="https://github.com/IsSlashy/Makora" target="_blank" rel="noopener noreferrer" className="hover:text-cursed transition-colors uppercase">
                GitHub
              </a>
              <a href="https://x.com/Protocol01_" target="_blank" rel="noopener noreferrer" className="hover:text-cursed transition-colors uppercase">
                Twitter
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
