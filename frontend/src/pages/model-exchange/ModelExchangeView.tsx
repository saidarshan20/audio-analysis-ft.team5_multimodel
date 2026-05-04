import { useState, useEffect, useCallback } from 'react';
import Dashboard from './Dashboard';
import AutoMLWizard from './tools/automl-wizard/AutoMLWizard';
import {
  ModelExchangeNavProvider,
  useModelExchangeNav,
} from './ModelExchangeNavContext';
import { clearModelExchangeSession } from './modelExchangeSession';
import type { TrainingRunSummary } from './tools/automl-wizard/types';

function ModelExchangeViewInner() {
  const [view, setView] = useState<'dashboard' | 'wizard'>('dashboard');
  const [wizardInitialRun, setWizardInitialRun] = useState<TrainingRunSummary | null>(null);
  const [resumeWizard, setResumeWizard] = useState(false);
  const [wizardKey, setWizardKey] = useState(0);
  const { setWizardNav } = useModelExchangeNav();

  const clearWizardInitial = useCallback(() => setWizardInitialRun(null), []);

  useEffect(() => {
    if (view === 'wizard') {
      setWizardNav(true, () => {
        setWizardInitialRun(null);
        setView('dashboard');
      });
    } else {
      setWizardNav(false, null);
    }
    return () => setWizardNav(false, null);
  }, [view, setWizardNav]);

  if (view === 'wizard') {
    return (
      <AutoMLWizard
        key={wizardKey}
        initialOpenRun={wizardInitialRun}
        onInitialOpenConsumed={clearWizardInitial}
        restoreSessionOnMount={resumeWizard}
        onSessionRestored={() => setResumeWizard(false)}
        onBackToDashboard={() => {
          setWizardInitialRun(null);
          setView('dashboard');
        }}
      />
    );
  }

  return (
    <Dashboard
      onStartProject={() => {
        clearModelExchangeSession();
        setWizardInitialRun(null);
        setResumeWizard(false);
        setWizardKey((k) => k + 1);
        setView('wizard');
      }}
      onResumeSession={() => {
        setWizardInitialRun(null);
        setResumeWizard(true);
        setWizardKey((k) => k + 1);
        setView('wizard');
      }}
      onOpenRunResults={(run) => {
        setResumeWizard(false);
        setWizardInitialRun(run);
        setWizardKey((k) => k + 1);
        setView('wizard');
      }}
    />
  );
}

export default function ModelExchangeView() {
  return (
    <ModelExchangeNavProvider>
      <ModelExchangeViewInner />
    </ModelExchangeNavProvider>
  );
}
