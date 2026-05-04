
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Send, Bot, ArrowRight } from 'lucide-react';
import './ChatButton.css';

// ─── API Config ─────────────────────────────────────────────────────────────
const API_BASE_URL = 'http://localhost:8766/api/chat';

// ─── Types ──────────────────────────────────────────────────────────────────
type Role = 'bot' | 'user';

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
}

// ─── Feature tag parsing ─────────────────────────────────────────────────────
// Matches [[FEATURE:featureId:Display Label]] at the end of bot messages
const FEATURE_TAG_RE = /\[\[FEATURE:(\w+):(.+?)\]\]/;

interface FeatureTag {
  featureId: string;
  label: string;
}

function extractFeatureTag(text: string): { clean: string; tag: FeatureTag | null } {
  const match = text.match(FEATURE_TAG_RE);
  if (!match) return { clean: text, tag: null };
  return {
    clean: text.replace(FEATURE_TAG_RE, '').trimEnd(),
    tag: { featureId: match[1], label: match[2] },
  };
}

// ─── ID helper ───────────────────────────────────────────────────────────────
const nextId = () =>
  `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// ─── Markdown renderer ────────────────────────────────────────────────────────
// Strips code fences / headings, renders **bold** and bullet lists as JSX.
function renderMarkdown(text: string, showCursor = false): React.ReactNode {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '');

  const allLines = cleaned.split('\n');

  // Find the last non-empty line so the cursor sits inline with the final character
  let lastRealIdx = -1;
  if (showCursor) {
    for (let i = allLines.length - 1; i >= 0; i--) {
      if (allLines[i].trim() && allLines[i].trim() !== '---') { lastRealIdx = i; break; }
    }
    // If no real line found yet (empty string while waiting), cursor goes at position 0
    if (lastRealIdx === -1) lastRealIdx = 0;
  }

  return allLines.map((line, i) => {
    if (!line.trim()) return <div key={i} style={{ height: '6px' }} />;
    if (line.trim() === '---') return <hr key={i} style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '12px 0' }} />;

    const isBullet = /^\s*[-*+]\s/.test(line);
    const content  = isBullet ? line.replace(/^\s*[-*+]\s/, '') : line;

    const parts = content.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={j} style={{ color: '#fb8c36', fontWeight: 600, letterSpacing: '0.01em' }}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={j} style={{ color: '#9fb0ca' }}>{part.slice(1, -1)}</em>;
      }
      return <span key={j}>{part}</span>;
    });

    return (
      <div key={i} style={{ marginBottom: '6px', paddingLeft: isBullet ? '14px' : '0', lineHeight: '1.55', display: 'flex', gap: isBullet ? '6px' : '0' }}>
        {isBullet && <span style={{ color: '#fb8c36', flexShrink: 0 }}>•</span>}
        <span>
          {parts}
          {showCursor && i === lastRealIdx && <span className="tw-caret">|</span>}
        </span>
      </div>
    );
  });
}

// ─── Typewriter (Only used for Initial Messages now) ──────────────────────────
interface TypewriterProps {
  text: string;
  speed?: number;
  onComplete: () => void;
}

const Typewriter = ({ text, speed = 18, onComplete }: TypewriterProps) => {
  const [displayed, setDisplayed] = useState('');
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let index = 0;
    setDisplayed('');
    const id = setInterval(() => {
      index += 1;
      setDisplayed(text.slice(0, index));
      if (index >= text.length) {
        clearInterval(id);
        onCompleteRef.current();
      }
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);

  const isTyping = displayed.length < text.length;
  return <>{renderMarkdown(displayed, isTyping)}</>;
};

// ─── Feature Navigation Button ───────────────────────────────────────────────
const FeatureNavButton = ({ tag, onNavigate }: { tag: FeatureTag; onNavigate: (id: string) => void }) => (
  <button
    className="chat-feature-btn"
    onClick={() => onNavigate(tag.featureId)}
  >
    <span className="chat-feature-btn-label">Try {tag.label}</span>
    <ArrowRight size={14} />
  </button>
);

// ─── Initial messages (module-level so IDs are stable) ───────────────────────
const INIT_MSGS: ChatMessage[] = [
  { id: nextId(), role: 'bot', content: 'Hi there! 👋 Welcome to Data2Insight AI.' },
  
];

// ─── ChatButton ───────────────────────────────────────────────────────────────
const ChatButton = () => {
  const navigate = useNavigate();
  const [isOpen,      setIsOpen]      = useState(false);
  const [isSpinning,  setIsSpinning]  = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading,   setIsLoading]   = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [messages,    setMessages]    = useState<ChatMessage[]>(INIT_MSGS);
  
  // IDs of bot messages that are still being typed (only used for INIT_MSGS now)
  const [typingIds,   setTypingIds]   = useState<Set<string>>(
    () => new Set(INIT_MSGS.map(m => m.id))
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const markDone = (id: string) =>
    setTypingIds(prev => { const s = new Set(prev); s.delete(id); return s; });

  const toggleChat = () => {
    setIsOpen(v => !v);
    setIsSpinning(true);
  };

  // ── Feature navigation handler ─────────────────────────────────────────────
  const handleFeatureNavigate = (featureId: string) => {
    // Close the chat
    setIsOpen(false);

    if (featureId === 'automl') {
      navigate('/Data2Insightai/model');
    } else if (featureId === 'datasets') {
      navigate('/Data2Insightai/datasets');
    } else {
      // Data Exchange tools: feat, viz, ocr, anon
      sessionStorage.setItem('home-start-tool', featureId);
      navigate('/Data2Insightai/data');
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const handleSend = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!inputMessage.trim() || isLoading) return;

    // 1. Add user message
    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: inputMessage.trim() };
    setInputMessage('');
    const history = [...messages, userMsg];
    setMessages(history);

    // 2. Add an empty bot message placeholder immediately
    const botMsgId = nextId();
    setMessages(prev => [...prev, { id: botMsgId, role: 'bot', content: '' }]);
    setStreamingMsgId(botMsgId);
    setIsLoading(true);

    // 3. Typewriter buffer — filled by the stream, drained char-by-char by the interval
    let streamBuffer = '';
    let displayedLength = 0;
    let streamDone = false;

    const typewriterInterval = setInterval(() => {
      if (displayedLength < streamBuffer.length) {
        // Catch up faster when the buffer has built up a backlog
        const lag = streamBuffer.length - displayedLength;
        const step = lag > 100 ? 5 : lag > 40 ? 2 : 1;
        displayedLength = Math.min(displayedLength + step, streamBuffer.length);
        const newContent = streamBuffer.slice(0, displayedLength);
        setMessages(prev =>
          prev.map(msg =>
            msg.id === botMsgId ? { ...msg, content: newContent } : msg
          )
        );
      } else if (streamDone) {
        clearInterval(typewriterInterval);
        setStreamingMsgId(null);
      }
    }, 20);

    try {
      const response = await fetch(API_BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      });

      if (!response.ok) throw new Error('Network response was not ok');
      if (!response.body) throw new Error('No response body');

      // 4. Read the stream into the buffer; the typewriter interval drains it
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          streamBuffer += decoder.decode(value, { stream: true });
        }
      }

      streamDone = true;
      setIsLoading(false);

    } catch (error) {
      console.error('Chat Error:', error);
      clearInterval(typewriterInterval);
      streamDone = true;
      setStreamingMsgId(null);
      setIsLoading(false);
      const errMsgId = nextId();
      setMessages(prev => [...prev, {
        id: errMsgId,
        role: 'bot',
        content: "Sorry, I'm having trouble connecting to the server right now. 😔",
      }]);
      setTypingIds(prev => new Set(prev).add(errMsgId));
    }
  };

  // ── Render a single bot message (with potential feature tag) ────────────────
  const renderBotContent = (msg: ChatMessage) => {
    const isStreaming = streamingMsgId === msg.id;

    if (msg.content === '') {
      // Waiting for first chunk — show jumping dots
      return (
        <div className="typing-indicator">
          <span className="ti-label">AI is thinking</span>
          <span className="ti-dots">
            <span /><span /><span />
          </span>
        </div>
      );
    }

    if (typingIds.has(msg.id)) {
      // Initial / error messages use the character-interval Typewriter
      return <Typewriter text={msg.content} speed={18} onComplete={() => markDone(msg.id)} />;
    }

    // Streamed API reply — extract feature tag, render markdown, then render nav button
    const { clean, tag } = extractFeatureTag(msg.content);

    return (
      <>
        {renderMarkdown(clean, isStreaming)}
        {tag && !isStreaming && (
          <FeatureNavButton tag={tag} onNavigate={handleFeatureNavigate} />
        )}
      </>
    );
  };

  return (
    <>
      {!isOpen && (
        <button
          className={`chat-fab-button ${isOpen ? 'active' : ''}`}
          onClick={toggleChat}
          aria-label={isOpen ? 'Close chat' : 'Open chat'}
        >
          {isOpen ? <X size={24} className="chat-icon" /> : (
            <span
              className={`chat-gears-icon${isSpinning ? ' is-spinning' : ''}`}
              aria-hidden="true"
              onAnimationEnd={() => setIsSpinning(false)}
            >
              <svg className="chat-star chat-star--cw"  width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
              <svg className="chat-star chat-star--ccw" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
            </span>
          )}
        </button>
      )}

      {isOpen && (
        <div className="chat-window view-animate-in">
          <div className="chat-header">
            <div className="chat-header-info">
              <Bot size={20} />
              <div className="chat-title">
                <h4>Data2Insight AI AI Assistant</h4>
                <span>Online</span>
              </div>
            </div>
            <button className="chat-close" onClick={toggleChat}>
              <X size={18} />
            </button>
          </div>

          <div className="chat-messages">
            {messages.map(msg => (
              <div key={msg.id} className={`chat-message ${msg.role}`}>
                {msg.role === 'bot' ? (
                  renderBotContent(msg)
                ) : (
                  <p style={{ margin: 0 }}>{msg.content}</p>
                )}
              </div>
            ))}

           

            <div ref={messagesEndRef} />
          </div>

          <form className="chat-input-area" onSubmit={handleSend}>
            <input
              type="text"
              placeholder="Type your question here..."
              value={inputMessage}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInputMessage(e.target.value)}
              className="chat-input"
              disabled={isLoading}
            />
            <button type="submit" className="chat-submit" disabled={!inputMessage.trim() || isLoading}>
              <Send size={18} />
            </button>
          </form>
        </div>
      )}
    </>
  );
};

export default ChatButton;
