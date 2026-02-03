'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/Header';
import { TheWheel } from '@/components/TheWheel';
import { PortfolioCard } from '@/components/PortfolioCard';
import { StrategyPanel } from '@/components/StrategyPanel';
import { StealthSessionsPanel } from '@/components/StealthSessionsPanel';
import { ActivityFeed } from '@/components/ActivityFeed';
import { RiskControls } from '@/components/RiskControls';
import { SettingsPanel } from '@/components/SettingsPanel';
import { LLMReasoningPanel } from '@/components/LLMReasoningPanel';
import { PolymarketPanel } from '@/components/PolymarketPanel';
import { useOODALoop } from '@/hooks/useOODALoop';
import { useYieldData } from '@/hooks/useYieldData';
import { useLLMConfig } from '@/hooks/useLLMConfig';
import { usePolymarket } from '@/hooks/usePolymarket';

export default function Home() {
  const ooda = useOODALoop();
  const { opportunities, loading: yieldLoading, lastUpdated, error: yieldError } = useYieldData();
  const { config: llmConfig, isConfigured: llmConfigured } = useLLMConfig();
  const { intelligence, loading: polyLoading, error: polyError } = usePolymarket();

  const [settingsOpen, setSettingsOpen] = useState(false);

  // Keep OODA loop fed with latest yield data
  useEffect(() => {
    ooda.setYields(opportunities);
  }, [opportunities, ooda.setYields]);

  // Feed LLM config to OODA loop
  useEffect(() => {
    if (llmConfig && llmConfig.apiKey) {
      ooda.setLLMConfig({
        providerId: llmConfig.providerId,
        apiKey: llmConfig.apiKey,
        model: llmConfig.model,
        temperature: llmConfig.temperature,
      });
    } else {
      ooda.setLLMConfig(null);
    }
  }, [llmConfig, ooda.setLLMConfig]);

  // Feed Polymarket data to OODA loop
  useEffect(() => {
    if (llmConfig?.enablePolymarket !== false && intelligence) {
      ooda.setPolymarketData(intelligence);
    } else {
      ooda.setPolymarketData(null);
    }
  }, [intelligence, llmConfig?.enablePolymarket, ooda.setPolymarketData]);

  const sentimentBias = intelligence?.sentimentSummary?.overallBias as 'bullish' | 'neutral' | 'bearish' | undefined;

  return (
    <div className="min-h-screen bg-bg-void">
      <Header
        onSettingsOpen={() => setSettingsOpen(true)}
        llmModel={llmConfigured ? llmConfig?.model : undefined}
        sentimentBias={sentimentBias}
      />

      <main className="max-w-[1200px] mx-auto px-4 py-6">
        {/* Top grid: Wheel + Portfolio + Strategy/LLM */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
          <div className="lg:col-span-2 lg:row-span-2">
            <TheWheel oodaState={ooda} />
          </div>
          <div>
            <PortfolioCard />
          </div>
          <div>
            {llmConfigured ? (
              <LLMReasoningPanel llmOrient={ooda.llmOrient} phase={ooda.phase} />
            ) : (
              <StrategyPanel
                oodaState={ooda}
                yields={opportunities}
                yieldLoading={yieldLoading}
                yieldLastUpdated={lastUpdated}
                yieldError={yieldError}
              />
            )}
          </div>
        </div>

        {/* Bottom grid: Polymarket + Sessions + Activity + Risk */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <PolymarketPanel
            intelligence={intelligence}
            loading={polyLoading}
            error={polyError}
          />
          <ActivityFeed />
          <div className="space-y-3">
            <StealthSessionsPanel oodaState={ooda} />
            <RiskControls />
          </div>
        </div>
      </main>

      {/* Settings drawer */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Footer */}
      <footer className="border-t border-cursed/8 mt-12">
        <div className="max-w-[1200px] mx-auto px-4 py-6">
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
