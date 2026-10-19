import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, traduireErreur, uid } from './supabase';
import Champs from './Formulaire.jsx';
import Modal from './Modal.jsx';
import { signalerSuppression } from './Corbeille.jsx';

/**
 * Liste + formulaire générique sur une table.
 * props : titre, table, champs, filtre {col: val}, select, ordre, colonnes [{cle, label, rendu}],
 *         lectureSeule, defauts, avantSauvegarde(row) -> row, actionsLigne(row) -> JSX, enTete (JSX)
 */
export default function Crud({
  titre, table, champs, filtre = {}, select = '*', ordre = 'nom', colonnes,
  lectureSeule = false, defauts = {}, avantSauvegarde, actionsLigne, enTete, rechercheSur,
  titreFormulaire, ajuster, choixListe,
}) {
  const [lignes, setLignes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [edition, setEdition] = useState(null);
  const [recherche, setRecherche] = useState('');
  const cleFiltre = JSON.stringify(filtre);

  const charger = useCallback(async () => {
    const f = JSON.parse(cleFiltre);
    if (Object.values(f).some((v) => v === null || v === undefined)) {
      setLignes([]);
      setChargement(false);
      return;
    }
    setChargement(true);
    let q = supabase.from(table).select(select);
    Object.entries(f).forEach(([k, v]) => { q = q.eq(k, v); });
    if (ordre) q = q.order(ordre);
    const { data, error } = await q;
    if (error) setErreur(traduireErreur(error));
    else { setErreur(''); setLignes(data || []); }
    setChargement(false);
  }, [table, select, ordre, cleFiltre]);

  useEffect(() => { charger(); }, [charger]);

  const filtrees = useMemo(() => {
    if (choixListe) return recherche ? lignes.filter((l) => l.id === recherche) : lignes;
    const t = recherche.trim().toLowerCase();
    if (!t) return lignes;
    const cles = rechercheSur || colonnes.map((c) => c.cle);
    return lignes.filter((l) => cles.some((k) => String((typeof k === 'function' ? k(l) : l[k]) ?? '').toLowerCase().includes(t)));
  }, [lignes, recherche, colonnes, rechercheSur, choixListe]);

  async function sauvegarder(valeurs) {
    let row = { ...valeurs };
    // On ne garde que les colonnes éditables
    const listeChamps = typeof champs === 'function' ? champs(valeurs) : champs;
    const autorisees = new Set([...listeChamps.map((c) => c.nom), ...Object.keys(filtre), ...Object.keys(defauts)]);
    Object.keys(row).forEach((k) => { if (!autorisees.has(k) && k !== 'id') delete row[k]; });
    if (avantSauvegarde) row = await avantSauvegarde(row);
    let res;
    if (row.id) {
      const { id, ...reste } = row;
      res = await supabase.from(table).update(reste).eq('id', id);
    } else {
      res = await supabase.from(table).insert({ id: uid(), ...row });
    }
    if (res.error) throw new Error(traduireErreur(res.error));
    setEdition(null);
    charger();
  }

  async function supprimer(l) {
    if (!confirm('Supprimer cet enregistrement ?\n(Vous pourrez annuler, ou le restaurer depuis la Corbeille.)')) return;
    const { error } = await supabase.from(table).delete().eq('id', l.id);
    if (error) alert(traduireErreur(error));
    else { signalerSuppression(l.nom || l.libelle || l.code || ''); charger(); }
  }

  return (
    <div>
      {titre && <h1>{titre}</h1>}
      {enTete}
      <div className="barre-outils">
        {choixListe ? (
          <select className="recherche" value={recherche} onChange={(e) => setRecherche(e.target.value)} aria-label={choixListe.tous}>
            <option value="">{choixListe.tous}</option>
            {[...lignes].sort((a, b) => choixListe.libelle(a).localeCompare(choixListe.libelle(b), 'fr', { numeric: true }))
              .map((l) => <option key={l.id} value={l.id}>{choixListe.libelle(l)}</option>)}
          </select>
        ) : (
          <input className="recherche" placeholder="Rechercher…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        )}
        <span className="discret">{filtrees.length} élément(s)</span>
        <div className="espace" />
        {!lectureSeule && <button className="btn" onClick={() => setEdition({ ...defauts, ...filtre })}>+ Ajouter</button>}
      </div>
      {erreur && <p className="erreur">{erreur}</p>}
      <div className="tableau-cadre">
        <table className="tableau">
          <thead>
            <tr>
              {colonnes.map((c) => <th key={c.cle}>{c.label}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {chargement && <tr><td colSpan={colonnes.length + 1} className="discret">Chargement…</td></tr>}
            {!chargement && filtrees.length === 0 && <tr><td colSpan={colonnes.length + 1} className="vide">Aucun enregistrement.</td></tr>}
            {filtrees.map((l) => (
              <tr key={l.id}>
                {colonnes.map((c) => <td key={c.cle}>{c.rendu ? c.rendu(l) : l[c.cle]}</td>)}
                <td className="actions-ligne">
                  {actionsLigne?.(l)}
                  {!lectureSeule && <button className="lien" onClick={() => setEdition(l)}>Modifier</button>}
                  {!lectureSeule && <button className="lien danger" onClick={() => supprimer(l)}>Supprimer</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edition && (
        <FormulaireModal
          titre={(edition.id ? 'Modifier' : 'Ajouter') + (titreFormulaire ? ` — ${titreFormulaire}` : '')}
          champs={champs}
          initial={edition}
          fermer={() => setEdition(null)}
          enregistrer={sauvegarder}
          ajuster={ajuster}
        />
      )}
    </div>
  );
}

export function FormulaireModal({ titre, champs, initial, fermer, enregistrer, large, surChangement, ajuster }) {
  const [valeurs, setValeursInterne] = useState(initial);
  const setValeurs = (v) => { const w = ajuster ? ajuster(v, valeurs) : v; setValeursInterne(w); surChangement?.(w); };
  // champs peut être une fonction des valeurs saisies (listes liées)
  const liste = typeof champs === 'function' ? champs(valeurs) : champs;
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  async function soumettre(e) {
    e.preventDefault();
    setEnvoi(true);
    setErreur('');
    try { await enregistrer(valeurs); } catch (err) { setErreur(err.message); }
    setEnvoi(false);
  }
  return (
    <Modal titre={titre} fermer={fermer} large={large || liste.length > 8}>
      <form onSubmit={soumettre} className="formulaire">
        <Champs champs={liste} valeurs={valeurs} changer={setValeurs} />
        {erreur && <p className="erreur">{erreur}</p>}
        <div className="actions">
          <button type="button" className="btn-contour" onClick={fermer}>Annuler</button>
          <button className="btn" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  );
}
