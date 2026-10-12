/**
 * Rendu générique de champs de formulaire.
 * champ = { nom, label, type, options:[{value,label}], requis, pleine, aide }
 */
export default function Champs({ champs, valeurs, changer }) {
  return (
    <div className="grille-champs">
      {champs.map((c) => {
        const v = valeurs[c.nom];
        const maj = (val) => changer({ ...valeurs, [c.nom]: val });
        const classe = c.pleine || c.type === 'textarea' ? 'pleine' : '';
        if (c.type === 'checkbox') {
          return (
            <label key={c.nom} className={`case ${classe}`}>
              <input type="checkbox" checked={!!v} onChange={(e) => maj(e.target.checked)} /> {c.label}
            </label>
          );
        }
        let entree;
        if (c.type === 'select') {
          entree = (
            <select value={v ?? ''} required={c.requis} onChange={(e) => maj(e.target.value === '' ? null : e.target.value)}>
              <option value="">{c.requis ? '— choisir —' : '—'}</option>
              {(c.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          );
        } else if (c.type === 'textarea') {
          entree = <textarea rows={3} value={v ?? ''} onChange={(e) => maj(e.target.value)} />;
        } else {
          entree = (
            <input
              type={c.type || 'text'}
              value={v ?? ''}
              required={c.requis}
              step={c.type === 'number' ? 'any' : undefined}
              onChange={(e) => maj(e.target.value === '' ? null : c.type === 'number' ? Number(e.target.value) : e.target.value)}
            />
          );
        }
        return (
          <label key={c.nom} className={classe}>
            <span>{c.label}{c.requis && <span className="requis"> *</span>}</span>
            {entree}
            {c.aide && <small className="discret">{c.aide}</small>}
          </label>
        );
      })}
    </div>
  );
}

export const OPTIONS = {
  statut_ecole: [
    { value: 'public', label: 'Public' },
    { value: 'prive_laic', label: 'Privé laïc' },
    { value: 'prive_confessionnel', label: 'Privé confessionnel' },
    { value: 'communautaire', label: 'Communautaire' },
  ],
  cycle_ecole: [
    { value: 'prescolaire', label: 'Préscolaire' },
    { value: 'primaire', label: 'Primaire' },
    { value: 'mixte', label: 'Préscolaire + primaire' },
  ],
  milieu: [
    { value: 'urbain', label: 'Urbain' },
    { value: 'rural', label: 'Rural' },
  ],
  sexe: [
    { value: 'M', label: 'Masculin' },
    { value: 'F', label: 'Féminin' },
  ],
  statut_eleve: [
    { value: 'nouveau', label: 'Nouveau' },
    { value: 'redoublant', label: 'Redoublant' },
    { value: 'transfere_entrant', label: 'Transféré (entrant)' },
  ],
  decision: [
    { value: 'admis', label: 'Admis' },
    { value: 'redouble', label: 'Redouble' },
    { value: 'exclu', label: 'Exclu' },
    { value: 'abandon', label: 'Abandon' },
    { value: 'transfere', label: 'Transféré' },
  ],
  position: [
    { value: 'en_activite', label: 'En activité' },
    { value: 'conge', label: 'Congé' },
    { value: 'detachement', label: 'Détachement' },
    { value: 'disponibilite', label: 'Disponibilité' },
    { value: 'stage', label: 'Stage' },
    { value: 'retraite', label: 'Retraite' },
    { value: 'decede', label: 'Décédé' },
  ],
};

export const libelle = (liste, v) => OPTIONS[liste]?.find((o) => o.value === v)?.label || v || '';
