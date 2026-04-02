import { RotateCcw, LogOut, ArrowLeft } from 'lucide-react';
import logo from '../assets/logo.png';
import './Navbar.css';

interface NavbarProps {
  showBack?: boolean;
  onBack?: () => void;
  onLogout?: () => void;
}

const Navbar = ({ showBack = false, onBack, onLogout }: NavbarProps) => {
  return (
    <nav className="navbar">
      <div className="navbar-container">
        <div className="navbar-logo" onClick={onBack} style={{cursor: showBack ? 'pointer' : 'default'}}>
          <img src={logo} alt="NTT DATA" className="navbar-logo-img" />
        </div>
        <div className="navbar-actions">
          <button className="action-button">
            <RotateCcw size={16} />
            <span>Reset</span>
          </button>
          {showBack && (
            <button className="action-button" onClick={onBack}>
              <ArrowLeft size={16} />
              <span>Back to Home</span>
            </button>
          )}
          <button className="action-button" onClick={onLogout}>
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
