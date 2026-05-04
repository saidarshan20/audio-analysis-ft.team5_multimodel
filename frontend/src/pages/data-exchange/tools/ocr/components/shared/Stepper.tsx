import React from 'react';
import { Upload, Play, FileText } from 'lucide-react';

type OcrStep = 'upload' | 'processing' | 'results';

export const OCR_STEPS: { id: OcrStep; label: string; Icon: React.ElementType }[] = [
  { id: 'upload',     label: 'Upload',     Icon: Upload   },
  { id: 'processing', label: 'Processing', Icon: Play     },
  { id: 'results',    label: 'Results',    Icon: FileText },
];

interface StepperProps {
  activeStep: OcrStep;
}

export const Stepper: React.FC<StepperProps> = ({ activeStep }) => {
  const activeIdx = OCR_STEPS.findIndex(s => s.id === activeStep);
  const stepperNodes: React.ReactNode[] = [];

  OCR_STEPS.forEach((step, idx) => {
    const isActive = step.id === activeStep;
    const isDone   = activeIdx > idx;

    // Logic: Connectors are orange if the following step is done OR active
    const isConnectorDone = activeIdx >= idx && idx > 0;

    // Make the finale step green (done) when active to signify completion
    const showAsActive = isActive && step.id !== 'results';
    const showAsDone = isDone || (isActive && step.id === 'results');

    if (idx > 0) {
      stepperNodes.push(<div key={`conn-${idx}`} className={`xt-connector${isConnectorDone || (isActive && step.id === 'results' && idx === activeIdx) ? ' done' : ''}`} />);
    }
    stepperNodes.push(
      <div key={step.id} className="xt-step">
        <div className={`xt-step-circle${showAsActive ? ' active' : showAsDone ? ' done' : ''}`}>
          <step.Icon size={20} />
        </div>
        <span className={`xt-step-label${showAsActive ? ' active' : showAsDone ? ' done' : ''}`}>{step.label}</span>
      </div>
    );
  });

  return (
    <div className="xt-stepper-card">
      <div className="xt-stepper">{stepperNodes}</div>
    </div>
  );
};