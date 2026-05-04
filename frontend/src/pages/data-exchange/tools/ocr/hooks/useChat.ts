import { useRef, useState } from 'react';
import { askDocument } from '../utils/ocrApi';

export const useChat = () => {
  const [chatHistories, setChatHistories] = useState<Record<string, Array<{ role: 'user' | 'assistant'; content: string; sources?: Array<{ text_snippet: string; score: number }> }>>>({});
  const [expandedSourcesHistories, setExpandedSourcesHistories] = useState<Record<string, Record<number, boolean>>>({});
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const getChatMessages = (selectedDocId: string) => chatHistories[selectedDocId] || [];
  const getExpandedSources = (selectedDocId: string) => expandedSourcesHistories[selectedDocId] || {};

  const appendUserMessage = (selectedDocId: string, message: string) => {
    setChatHistories((prev) => ({
      ...prev,
      [selectedDocId]: [...(prev[selectedDocId] || []), { role: 'user', content: message }],
    }));
  };

  const appendAssistantMessage = (selectedDocId: string, response: any) => {
    setChatHistories((prev) => ({
      ...prev,
      [selectedDocId]: [
        ...(prev[selectedDocId] || []),
        { role: 'assistant', content: response.answer || 'No response.', sources: response.sources || [] },
      ],
    }));
  };

  const toggleSourceExpansion = (selectedDocId: string, messageIndex: number) => {
    setExpandedSourcesHistories((prev) => ({
      ...prev,
      [selectedDocId]: {
        ...(prev[selectedDocId] || {}),
        [messageIndex]: !(prev[selectedDocId] || {})[messageIndex],
      },
    }));
  };

  const sendChatMessage = async (
    selectedDocId: string,
    resultData: any,
    allResults: any[],
    question: string,
    existingMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ) => {
    if (!question || isChatLoading) return;

    appendUserMessage(selectedDocId, question);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const payload: any = {
        document_id: selectedDocId === 'all' ? 'all' : resultData?.document?.id,
        question,
        history: existingMessages,
      };

      if (selectedDocId === 'all' && allResults.length > 0) {
        payload.document_ids = allResults.map((r) => r.document.id);
      }

      const data = await askDocument(payload);
      appendAssistantMessage(selectedDocId, data);
    } catch {
      setChatHistories((prev) => ({
        ...prev,
        [selectedDocId]: [
          ...(prev[selectedDocId] || []),
          { role: 'assistant', content: 'Failed to reach the chat service. Is the backend running?' },
        ],
      }));
    } finally {
      setIsChatLoading(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  return {
    chatHistories,
    expandedSourcesHistories,
    getChatMessages,
    getExpandedSources,
    chatInput,
    setChatInput,
    isChatLoading,
    chatEndRef,
    sendChatMessage,
    toggleSourceExpansion,
    setChatHistories,
    setExpandedSourcesHistories,
  };
};
