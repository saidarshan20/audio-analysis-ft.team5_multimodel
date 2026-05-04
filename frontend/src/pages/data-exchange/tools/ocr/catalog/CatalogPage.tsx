import { ArrowLeft, Database } from 'lucide-react';
import '../ToolPage.css';
import CatalogView from './CatalogView';

const CatalogPage = ({ onBack }: { onBack: () => void }) => {
  return (
    <div className="xt-page">
      <button className="xt-back-btn" onClick={onBack}>
        <ArrowLeft size={14} /> Back to Data Tools
      </button>

      <div className="xt-header">
        <div className="xt-header-icon">
          <Database size={26} />
        </div>
        <div>
          <h1 className="xt-header-title">Data Catalog</h1>
          <p className="xt-header-subtitle">Browse, preview, download, and analyze data.gov.in datasets</p>
        </div>
      </div>

      <div className="xt-panel">
        <CatalogView />
      </div>
    </div>
  );
};

export default CatalogPage;

