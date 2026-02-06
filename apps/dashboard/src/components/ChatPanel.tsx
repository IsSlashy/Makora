'use client';

import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '@/hooks/useOpenClaw';

interface ChatPanelProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  isConnected: boolean;
  error: string | null;
  onSendMessage: (content: string) => void;
  onClearChat: () => void;
  onCheckConnection: () => void;
}

export const ChatPanel = ({
  messages,
  isStreaming,
  isConnected,
  error,
  onSendMessage,
  onClearChat,
  onCheckConnection,
}: ChatPanelProps) => {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    onSendMessage(trimmed);
    setInput('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const visibleMessages = messages.filter(m => m.role !== 'system');

  return (
    <div className="h-full flex flex-col cursed-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-cursed/10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs md:text-[10px] font-mono tracking-[0.2em] text-cursed uppercase font-bold">
            会 MAKORA AGENT
          </span>
          <span className={`inline-flex items-center gap-1 text-[11px] md:text-[9px] font-mono ${
            isConnected ? 'text-positive' : 'text-text-muted'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              isConnected ? 'bg-positive' : 'bg-text-muted'
            } ${isStreaming ? 'animate-pulse' : ''}`} />
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCheckConnection}
            className="text-[11px] md:text-[9px] font-mono text-text-muted hover:text-cursed transition-colors p-2"
            title="Check connection"
          >
            &#x27F3;
          </button>
          <button
            onClick={onClearChat}
            className="text-[11px] md:text-[9px] font-mono text-text-muted hover:text-negative transition-colors p-2"
            title="Clear chat"
          >
            CLEAR
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
        {visibleMessages.length === 0 && (
          <div className="text-center text-text-muted text-xs md:text-[10px] font-mono py-8">
            <div className="text-cursed/40 text-2xl mb-2">会</div>
            <div>Makora agent ready.</div>
            <div className="mt-1">Ask about portfolio, markets, or strategy.</div>
          </div>
        )}

        {visibleMessages.map((msg) => (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <div className="flex justify-end">
                <div className="max-w-[80%]">
                  <div className="text-[11px] md:text-[9px] font-mono text-text-muted text-right mb-0.5 tracking-wider">
                    YOU
                  </div>
                  <div className="bg-bg-inner border border-cursed/15 px-3 py-2 text-[11px] font-mono text-text-primary leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex justify-start">
                <div className="max-w-[85%]">
                  <div className="text-[11px] md:text-[9px] font-mono text-cursed mb-0.5 tracking-wider">
                    MAKORA
                  </div>
                  <div className="bg-bg-inner border border-shadow-purple/15 px-3 py-2 text-[11px] font-mono text-text-secondary leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                    {isStreaming && msg.id === visibleMessages[visibleMessages.length - 1]?.id && msg.role === 'assistant' && (
                      <span className="inline-block w-1.5 h-3 bg-cursed/60 ml-0.5 animate-pulse" />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {error && (
          <div className="text-center text-xs md:text-[10px] font-mono text-negative/80 py-1">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-cursed/10 px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isConnected ? 'Type a message...' : 'Configure AI model in settings first'}
            disabled={!isConnected || isStreaming}
            className="flex-1 px-3 py-3 text-[11px] font-mono bg-bg-inner border border-cursed/15 text-text-primary placeholder:text-text-muted/50 focus:border-cursed/40 focus:outline-none disabled:opacity-40"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || !isConnected || isStreaming}
            className="px-4 py-3 text-xs md:text-[10px] font-mono tracking-[0.1em] uppercase bg-cursed/15 border border-cursed/30 text-cursed hover:bg-cursed/25 transition-colors font-bold disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isStreaming ? '...' : 'SEND'}
          </button>
        </div>
      </div>
    </div>
  );
};
