import React, { useState } from 'react';
import { MessageSquare, X, Send, Bot } from 'lucide-react';
import './ChatButton.css';

const ChatButton = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  
  const toggleChat = () => setIsOpen(!isOpen);

  const handleSend = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (message.trim()) {
      // In a real app, you would send this to your backend/LLM
      setMessage('');
    }
  };

  return (
    <>
      <button 
        className={`chat-fab-button ${isOpen ? 'active' : ''}`} 
        onClick={toggleChat}
        aria-label={isOpen ? "Close chat" : "Open chat"}
      >
        {isOpen ? <X size={24} className="chat-icon" /> : <MessageSquare size={24} className="chat-icon" />}
      </button>

      {isOpen && (
        <div className="chat-window view-animate-in">
          <div className="chat-header">
            <div className="chat-header-info">
              <Bot size={20} />
              <div className="chat-title">
                <h4>AI Sphere Assistant</h4>
                <span>Online</span>
              </div>
            </div>
            <button className="chat-close" onClick={toggleChat}>
              <X size={18} />
            </button>
          </div>
          
          <div className="chat-messages">
            <div className="chat-message bot">
              <p>Hi there! 👋 Welcome to AI Sphere.</p>
            </div>
            <div className="chat-message bot">
              <p>How can I help you navigate the data and model exchange today?</p>
            </div>
            
            {/* Real app would map over an array of messages here */}
          </div>
          
          <form className="chat-input-area" onSubmit={handleSend}>
            <input 
              type="text" 
              placeholder="Type your question here..." 
              value={message}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMessage(e.target.value)}
              className="chat-input"
            />
            <button type="submit" className="chat-submit" disabled={!message.trim()}>
              <Send size={18} />
            </button>
          </form>
        </div>
      )}
    </>
  );
};

export default ChatButton;
