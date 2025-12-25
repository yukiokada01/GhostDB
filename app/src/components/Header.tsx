import '../styles/Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="header-container">
        <div className="brand">
          <div className="brand-mark">G</div>
          <div>
            <p className="brand-title">GhostDB</p>
            <p className="brand-subtitle">Encrypted documents with Zama</p>
          </div>
        </div>
      </div>
    </header>
  );
}
