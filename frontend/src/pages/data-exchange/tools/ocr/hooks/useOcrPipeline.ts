import { useCallback, useState, useRef } from 'react';
import { getJobResult, getJobStatus, uploadFile } from '../utils/ocrApi';

type OcrStep = 'upload' | 'processing' | 'results';
type ResultTab = 'raw_text' | 'structured_data' | 'ai_insights' | 'ask_document' | 'dataset_integrator';

export const useOcrPipeline = (files: File[]) => {
  const [activeStep, setActiveStep] = useState<OcrStep>('upload');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');
  const [allResults, setAllResults] = useState<any[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<ResultTab>('raw_text');
  
  const pollIntervalRef = useRef<number | null>(null);

  const fetchResults = useCallback(async (jobIds: string[]) => {
    setStatusText('Fetching results...');
    const results: any[] = [];

    for (const jobId of jobIds) {
      const data = await getJobResult(jobId);
      results.push(data);
    }

    setAllResults(results);
    setActiveStep('results');
    if (results.length > 0) {
      setSelectedDocId(results[0].document.id);
    }
    setActiveTab('raw_text');
  }, []);

  const startPipeline = useCallback(async () => {
    if (files.length === 0) return;

    setActiveStep('processing');
    setProgress(0);
    setStatusText(`Uploading ${files.length} document(s)...`);
    setErrorText('');

    try {
      const jobIds: string[] = [];
      for (const file of files) {
        const uploadData = await uploadFile(file);
        jobIds.push(uploadData.job_id);
      }

      const pollInterval = window.setInterval(async () => {
        try {
          let totalProgress = 0;
          let allCompleted = true;
          let hasError = false;

          for (const jobId of jobIds) {
            const statusData = await getJobStatus(jobId);
            totalProgress += statusData.progress;
            if (statusData.status === 'failed') hasError = true;
            if (statusData.status !== 'completed' && statusData.status !== 'failed') {
              allCompleted = false;
            }
          }

          const avgProgress = Math.round(totalProgress / jobIds.length);
          setProgress(avgProgress);
          setStatusText(`Processing: ${avgProgress}% across ${jobIds.length} file(s)`);

          if (allCompleted || hasError) {
            if (pollIntervalRef.current) {
               window.clearInterval(pollIntervalRef.current);
               pollIntervalRef.current = null;
            }
            if (hasError) {
              setErrorText('One or more documents failed to process.');
              setActiveStep('upload');
            } else {
              setStatusText('Fetching final results...');
              await fetchResults(jobIds);
            }
          }
        } catch {
          // continue polling until success or final error
        }
      }, 2000);
      pollIntervalRef.current = pollInterval;
    } catch (error) {
      console.error(error);
      setErrorText('Failed to start pipeline. Ensure backend is running and files are valid.');
      setActiveStep('upload');
    }
  }, [files, fetchResults]);

  const stopPipeline = useCallback(() => {
    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setActiveStep('upload');
    setErrorText('Pipeline processing was cancelled.');
  }, []);

  return {
    activeStep,
    progress,
    statusText,
    errorText,
    allResults,
    selectedDocId,
    activeTab,
    setSelectedDocId,
    setActiveTab,
    startPipeline,
    stopPipeline,
    setErrorText,
    setAllResults,
    setActiveStep,
  };
};
