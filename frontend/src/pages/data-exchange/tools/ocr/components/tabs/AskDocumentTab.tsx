import React from 'react';
import { MessageCircle, Send, Loader2, ChevronDown as ChevDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface AskDocumentTabProps {
  selectedDocId: string;
  chatMessages: Array<{ role: 'user' | 'assistant'; content: string; sources?: Array<{ text_snippet: string; score: number }> }>;
  expandedSources: Record<number, boolean>;
  chatInput: string;
  isChatLoading: boolean;
  chatEmptyTitle: string;
  chatEmptyDescription: string;
  chatSuggestions: string[];
  chatEndRef: React.RefObject<HTMLDivElement>;
  onChatInputChange: (value: string) => void;
  onSendMessage: () => void;
  onToggleSources: (messageIndex: number) => void;
  onSuggestionClick: (suggestion: string) => void;
}

export const AskDocumentTab: React.FC<AskDocumentTabProps> = ({
  selectedDocId,
  chatMessages,
  expandedSources,
  chatInput,
  isChatLoading,
  chatEmptyTitle,
  chatEmptyDescription,
  chatSuggestions,
  chatEndRef,
  onChatInputChange,
  onSendMessage,
  onToggleSources,
  onSuggestionClick,
}) => {
  return (
    <div className="xt-tab-panel">
      <div className="xt-chat-container">
        <div className="xt-chat-messages">
          {chatMessages.length === 0 && (
            <div className="xt-chat-empty">
              <MessageCircle size={40} />
              <h3>{chatEmptyTitle}</h3>
              <p>{chatEmptyDescription}</p>
              <div className="xt-chat-suggestions">
                {chatSuggestions.map((suggestion) => (
                  <button key={suggestion} onClick={() => onSuggestionClick(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          {chatMessages.map((msg, i) => (
            <div key={i} className={`xt-chat-bubble xt-chat-bubble--${msg.role}`}>
              <div className="xt-chat-bubble-content">
                {msg.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{msg.content}</ReactMarkdown>
                ) : (
                  <p>{msg.content}</p>
                )}
              </div>
              {msg.sources && msg.sources.length > 0 && (
                <div className="xt-chat-sources">
                  <button
                    className="xt-chat-sources-toggle"
                    onClick={() => onToggleSources(i)}
                  >
                    <ChevDown size={14} className={expandedSources[i] ? 'rotated' : ''} />
                    {msg.sources.length} source{msg.sources.length > 1 ? 's' : ''}
                  </button>
                  {expandedSources[i] && (
                    <div className="xt-chat-sources-list">
                      {msg.sources.map((src, j) => (
                        <div key={j} className="xt-chat-source-item">
                          <span className="xt-chat-source-score">{(src.score * 100).toFixed(0)}%</span>
                          <span className="xt-chat-source-text">{src.text_snippet}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {isChatLoading && (
            <div className="xt-chat-bubble xt-chat-bubble--assistant">
              <div className="xt-chat-bubble-content xt-chat-loading">
                <Loader2 size={16} className="xt-spin" /> Thinking...
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="xt-chat-input-row">
          <input
            className="xt-chat-input"
            value={chatInput}
            onChange={e => onChatInputChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendMessage(); } }}
            placeholder="Ask a question about this document..."
            disabled={isChatLoading}
          />
          <button
            className="xt-chat-send"
            onClick={onSendMessage}
            disabled={!chatInput.trim() || isChatLoading}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};