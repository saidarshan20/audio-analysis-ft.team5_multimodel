import { useEffect, useState } from 'react';
import { analyzeText, getFrequency, getKnowledgeGraph, getLinguistic, getWordcloud } from '../utils/ocrApi';

const toCleanList = (values: any): string[] =>
  Array.isArray(values)
    ? values
        .filter((v: any) => typeof v === 'string' && v.trim().length > 0)
        .map((v: string) => v.trim())
    : [];

const buildRelationshipCandidates = (nlpData: any): string[] => {
  const structured = nlpData?.structured_entities || {};
  const explicit = toCleanList(structured.relationships);
  const people = toCleanList(structured.people);
  const organizations = toCleanList(structured.organizations);
  const amounts = toCleanList(structured.amounts);
  const dates = toCleanList(structured.dates);
  const actions = Array.isArray(nlpData?.insights?.action_items)
    ? nlpData.insights.action_items.filter((item: any) => item && typeof item.task === 'string' && item.task.trim().length > 0)
    : [];

  const fallback: string[] = [];

  if (organizations.length > 0 && amounts.length > 0) {
    fallback.push(`${organizations[0]} -> payment -> ${amounts[0]}`);
  } else if (people.length > 0 && amounts.length > 0) {
    fallback.push(`${people[0]} -> payment -> ${amounts[0]}`);
  }

  if (organizations.length > 0 && dates.length > 0) {
    fallback.push(`${organizations[0]} -> due_on -> ${dates[0]}`);
  } else if (people.length > 0 && dates.length > 0) {
    fallback.push(`${people[0]} -> due_on -> ${dates[0]}`);
  }

  actions.slice(0, 4).forEach((item: any) => {
    const actor = typeof item.assignee === 'string' && item.assignee.trim().length > 0 ? item.assignee.trim() : (organizations[0] || people[0] || 'Document');
    const task = item.task.trim().replace(/\s+/g, ' ').slice(0, 72);
    fallback.push(`${actor} -> action -> ${task}`);
    if (typeof item.due_date === 'string' && item.due_date.trim().length > 0) {
      fallback.push(`${task.slice(0, 48)} -> due_on -> ${item.due_date.trim()}`);
    }
  });

  return Array.from(new Set([...explicit, ...fallback])).slice(0, 16);
};

export const useAiInsights = (selectedDocId: string, allResults: any[]) => {
  const [aiInsightsCache, setAiInsightsCache] = useState<Record<string, any>>({});
  const [nlpData, setNlpData] = useState<any>(null);
  const [wordcloudSrc, setWordcloudSrc] = useState<string | null>(null);
  const [linguisticSrc, setLinguisticSrc] = useState<string | null>(null);
  const [linguisticError, setLinguisticError] = useState<string | null>(null);
  const [knowledgeGraphSrc, setKnowledgeGraphSrc] = useState<string | null>(null);
  const [frequencyData, setFrequencyData] = useState<Array<{ text: string; frequency: number }>>([]);
  const [linguisticData, setLinguisticData] = useState<Record<string, number>>({});
  const [isNlpLoading, setIsNlpLoading] = useState(false);

  useEffect(() => {
    if (selectedDocId === 'all') return;
    const docData = allResults.find((result) => result.document.id === selectedDocId);
    if (!docData) return;

    const cached = aiInsightsCache[selectedDocId];
    const hasUsableCache =
      !!cached &&
      !!(
        cached.nlpData ||
        cached.wordcloudSrc ||
        cached.linguisticSrc ||
        cached.knowledgeGraphSrc ||
        (Array.isArray(cached.frequencyData) && cached.frequencyData.length > 0) ||
        (cached.linguisticData && Object.keys(cached.linguisticData).length > 0) ||
        cached.linguisticError
      );

    if (hasUsableCache) {
      setNlpData(cached.nlpData);
      setWordcloudSrc(cached.wordcloudSrc);
      setFrequencyData(cached.frequencyData);
      setLinguisticSrc(cached.linguisticSrc);
      setKnowledgeGraphSrc(cached.knowledgeGraphSrc);
      setLinguisticData(cached.linguisticData);
      setLinguisticError(cached.linguisticError);
      return;
    }

    const generateAiInsights = async () => {
      setIsNlpLoading(true);
      setNlpData(null);
      setWordcloudSrc(null);
      setLinguisticSrc(null);
      setLinguisticError(null);
      setKnowledgeGraphSrc(null);
      setFrequencyData([]);
      setLinguisticData({});

      const pages = docData?.document?.pages || [];
      const fullText = pages.map((p: any) => p.text || '').join('\n\n');
      const truncatedText = fullText.substring(0, 12000);
      const longText = fullText.substring(0, 15000);

      let newNlpData = null;
      let newWordcloudSrc = null;
      let newFreqData: any = [];
      let newLingSrc = null;
      let newLingData = {};
      let newLingError = null;
      let newKnowledgeGraphSrc = null;

      try {
        if (truncatedText) {
          try {
            newNlpData = await analyzeText(truncatedText, [
              'sentiment',
              'intent',
              'keyphrases',
              'ner',
              'language',
              'summary',
              'risk',
              'structured_entities',
              'insights',
            ]);
            setNlpData(newNlpData);

            const relationshipCandidates = buildRelationshipCandidates(newNlpData);
            if (relationshipCandidates.length > 0) {
              const kgResponse = await getKnowledgeGraph(relationshipCandidates, 'hybrid').catch(() => null);
              if (kgResponse?.image_base64) {
                newKnowledgeGraphSrc = kgResponse.image_base64;
                setKnowledgeGraphSrc(newKnowledgeGraphSrc);
              }
            }
          } catch (error) {
            // Keep visualizations running even if analytics fails.
            console.error('Document analysis failed, continuing with visualizations.', error);
          }
        }

        if (longText) {
          const [wordcloudResponse, frequencyResponse, linguisticResponse] = await Promise.all([
            getWordcloud(longText).catch(() => null),
            getFrequency(longText).catch(() => null),
            getLinguistic(longText).catch(() => null),
          ]);

          if (wordcloudResponse?.image_base64) {
            newWordcloudSrc = wordcloudResponse.image_base64;
            setWordcloudSrc(newWordcloudSrc);
          }

          if (Array.isArray(frequencyResponse?.data)) {
            newFreqData = frequencyResponse.data;
            setFrequencyData(newFreqData);
          }

          if (linguisticResponse) {
            if (linguisticResponse.image_base64) {
              newLingSrc = linguisticResponse.image_base64;
              setLinguisticSrc(newLingSrc);
            }
            if (linguisticResponse.pos_distribution) {
              newLingData = linguisticResponse.pos_distribution;
              setLinguisticData(newLingData);
            }
            if (linguisticResponse.error_message) {
              newLingError = linguisticResponse.error_message;
              setLinguisticError(newLingError);
            }
          }
        }
      } catch (error) {
        console.error('AI Insight generation failed', error);
      } finally {
        setAiInsightsCache((prev) => ({
          ...prev,
          [selectedDocId]: {
            nlpData: newNlpData,
            wordcloudSrc: newWordcloudSrc,
            frequencyData: newFreqData,
            linguisticSrc: newLingSrc,
            linguisticData: newLingData,
            linguisticError: newLingError,
            knowledgeGraphSrc: newKnowledgeGraphSrc,
          },
        }));
        setIsNlpLoading(false);
      }
    };

    generateAiInsights();
  }, [selectedDocId, allResults, aiInsightsCache]);

  return {
    nlpData,
    wordcloudSrc,
    linguisticSrc,
    linguisticError,
    knowledgeGraphSrc,
    frequencyData,
    linguisticData,
    isNlpLoading,
    aiInsightsCache,
    setAiInsightsCache,
  };
};
