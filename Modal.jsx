export default function Modal({ titre, fermer, children, large }) {
  return (
    <div className="voile" onMouseDown={(e) => e.target === e.currentTarget && fermer()}>
      <div className={`modal ${large ? 'large' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-tete">
          <h3>{titre}</h3>
          <button className="fermer" onClick={fermer} aria-label="Fermer">×</button>
        </div>
        <div className="modal-corps">{children}</div>
      </div>
    </div>
  );
}
