import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur, uid } from './supabase';
import { FormulaireModal } from './Crud.jsx';
import { dateFr } from './Choix.jsx';

const NIVEAUX = ['PS', 'MS', 'GS', 'CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];

export function useCompositions() {
  const { ieppId, annee } = useApp();
  const [liste, setListe] = useState([]);
  const charger = useCallback(async () => {
    if (!ieppId || !annee) { setListe([]); return; }
    const { data } = await supabase.from('compositions').select('*').eq('iepp_id', ieppId).eq('annee_id', annee.id).order('ordre');
    setListe(data || []);
  }, [ieppId, annee]);
  useEffect(() => { charger(); }, [charger]);
  return [liste, charger];
}

export default function Compositions() {
  const { ieppId, annee, peutGerer, role } = useApp();
  const [liste, charger] = useCompositions();
  const [edition, setEdition] = useState(null);
  const nav = useNavigate();

  const champs = [
    { nom: 'libelle', label: 'Libellé (ex. 1re composition)', requis: true, pleine: true },
    { nom: 'ordre', label: "Ordre dans l'année", type: 'number', requis: true },
    { nom: 'date_debut', label: 'Début', type: 'date' },
    { nom: 'date_fin', label: 'Fin', type: 'date' },
    { nom: 'saisie_ouverte', label: 'Saisie des notes ouverte', type: 'checkbox', pleine: true },
    ...NIVEAUX.map((n) => ({ nom: `n_${n}`, label: `Niveau ${n}`, type: 'checkbox' })),
  ];

  function ouvrir(c) {
    const base = c || { ordre: liste.length + 1, saisie_ouverte: true, niveaux: ['CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'] };
    const v = { ...base };
    NIVEAUX.forEach((n) => { v[`n_${n}`] = base.niveaux.includes(n); });
    setEdition(v);
  }

  async function enregistrer(v) {
    const row = {
      libelle: v.libelle, ordre: v.ordre, date_debut: v.date_debut || null, date_fin: v.date_fin || null,
      saisie_ouverte: !!v.saisie_ouverte, niveaux: NIVEAUX.filter((n) => v[`n_${n}`]),
    };
    if (!row.niveaux.length) throw new Error('Cochez au moins un niveau.');
    const res = v.id
      ? await supabase.from('compositions').update(row).eq('id', v.id)
      : await supabase.from('compositions').insert({ id: uid(), iepp_id: ieppId, annee_id: annee.id, ...row });
    if (res.error) throw new Error(traduireErreur(res.error));
    setEdition(null);
    charger();
  }

  async function basculer(c) {
    const { error } = await supabase.from('compositions').update({ saisie_ouverte: !c.saisie_ouverte }).eq('id', c.id);
    if (error) alert(traduireErreur(error));
    charger();
  }

  async function supprimer(c) {
    if (!confirm(`Supprimer « ${c.libelle} » et TOUTES ses notes ?`)) return;
    const { error } = await supabase.from('compositions').delete().eq('id', c.id);
    if (error) alert(traduireErreur(error));
    charger();
  }

  if (!annee) return <div><h1>Compositions</h1><p className="vide">Aucune année scolaire active.</p></div>;

  return (
    <div>
      <h1>Compositions</h1>
      <p className="sous-titre">Compositions organisées par la circonscription en {annee.libelle}. Chaque école saisit ses notes tant que la saisie est ouverte.</p>
      {peutGerer && <div className="barre-outils"><div className="espace" /><button className="btn" onClick={() => ouvrir(null)}>+ Nouvelle composition</button></div>}
      <div className="grille-cartes">
        {liste.length === 0 && <p className="vide">Aucune composition programmée.</p>}
        {liste.map((c) => (
          <div key={c.id} className="carte composition">
            <div className="titre-ligne">
              <h3>{c.libelle}</h3>
              <span className={`badge ${c.saisie_ouverte ? 'vert' : 'gris'}`}>{c.saisie_ouverte ? 'Saisie ouverte' : 'Saisie fermée'}</span>
            </div>
            <p className="discret">{c.date_debut ? `Du ${dateFr(c.date_debut)} au ${dateFr(c.date_fin)}` : 'Dates non fixées'}</p>
            <p className="etiquettes">{c.niveaux.map((n) => <span key={n} className="badge">{n}</span>)}</p>
            <div className="actions">
              {(c.saisie_ouverte || peutGerer) && role !== 'conseiller' && <button className="btn" onClick={() => nav(`/compositions/${c.id}/saisie`)}>Saisir les notes</button>}
              {peutGerer && <button className="btn-contour" onClick={() => basculer(c)}>{c.saisie_ouverte ? 'Fermer la saisie' : 'Rouvrir'}</button>}
              {peutGerer && <button className="lien" onClick={() => ouvrir(c)}>Modifier</button>}
              {peutGerer && <button className="lien danger" onClick={() => supprimer(c)}>Supprimer</button>}
            </div>
          </div>
        ))}
      </div>
      {edition && <FormulaireModal titre={edition.id ? 'Modifier la composition' : 'Nouvelle composition'} champs={champs} initial={edition} fermer={() => setEdition(null)} enregistrer={enregistrer} large />}
    </div>
  );
}
