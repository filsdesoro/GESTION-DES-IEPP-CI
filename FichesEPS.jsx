import { useEffect, useState } from 'react';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
import { ChoixEcoleClasse, dateFr, nomComplet, useEcoles } from './Choix.jsx';
import { useInscrits } from './Eleves.jsx';
import { EnTeteOfficiel } from './Releves.jsx';
import { signalerSuppression, supprimerEleve } from './Corbeille.jsx';

export default function FichesEPS() {
  const { iepp, annee, role } = useApp();
  const [choix, setChoix] = useState({ ecoleId: null, classeId: null });
  const [classe, setClasse] = useState(null);
  const [inscrits, recharger] = useInscrits(choix.classeId);
  const ecoles = useEcoles();
  const [fiches, setFiches] = useState({});
  const [msg, setMsg] = useState('');
  const modifiable = role !== 'conseiller';

  useEffect(() => {
    if (!inscrits.length) { setFiches({}); return; }
    supabase.from('fiches_eps').select('*').in('inscription_id', inscrits.map((i) => i.id)).then(({ data }) => {
      const f = {};
      inscrits.forEach((i) => { f[i.id] = { inscription_id: i.id, apte: true, taille_cm: null, poids_kg: null, motif_inaptitude: '', observations: '' }; });
      (data || []).forEach((x) => { f[x.inscription_id] = x; });
      setFiches(f);
    });
  }, [inscrits]);

  async function effacerFiche(i) {
    const f = fiches[i.id];
    if (!f?.id) return;
    if (!confirm(`Supprimer la fiche EPS de ${nomComplet(i.eleves)} (aptitude, taille, poids) ?\n(Vous pourrez annuler, ou la restaurer depuis la Corbeille.)`)) return;
    const { error } = await supabase.from('fiches_eps').delete().eq('id', f.id);
    if (error) return setMsg(traduireErreur(error));
    setFiches((x) => ({ ...x, [i.id]: { inscription_id: i.id, apte: true, taille_cm: null, poids_kg: null, motif_inaptitude: '', observations: '' } }));
    signalerSuppression(`Fiche EPS de ${nomComplet(i.eleves)}`);
  }
  async function retirerEleve(i) {
    if (!confirm(`Supprimer l'élève ${nomComplet(i.eleves)} ?\nSon inscription, ses notes et sa fiche EPS seront effacées.\n(Vous pourrez annuler, ou le restaurer depuis la Corbeille.)`)) return;
    const err = await supprimerEleve(i.id);
    if (err) return setMsg(err);
    signalerSuppression(nomComplet(i.eleves));
    recharger();
  }

  const maj = (id, k, v) => setFiches((f) => ({ ...f, [id]: { ...f[id], [k]: v } }));

  async function enregistrer() {
    const lignes = Object.values(fiches).map(({ inscription_id, apte, taille_cm, poids_kg, motif_inaptitude, observations }) => ({
      inscription_id, apte, taille_cm: taille_cm === '' ? null : taille_cm, poids_kg: poids_kg === '' ? null : poids_kg,
      motif_inaptitude: apte ? null : motif_inaptitude, observations,
    }));
    const { error } = await supabase.from('fiches_eps').upsert(lignes, { onConflict: 'inscription_id' });
    setMsg(error ? traduireErreur(error) : 'Fiches EPS enregistrées.');
  }

  const inaptes = Object.values(fiches).filter((f) => !f.apte).length;
  const ecole = ecoles.find((e) => e.id === choix.ecoleId);

  return (
    <div>
      <h1 className="non-imprime">Fiches EPS</h1>
      <div className="non-imprime"><ChoixEcoleClasse valeur={choix} changer={(v, c) => { setChoix(v); setClasse(c); }} /></div>
      {classe && (
        <div className="document">
          <div className="imprime-seul"><EnTeteOfficiel iepp={iepp} ecole={ecole} droite={<div>Année scolaire {annee?.libelle}</div>} /><h2 className="titre-doc">FICHE D'APTITUDE EPS — {classe.nom}</h2></div>
          <div className="barre-outils non-imprime">
            <span className="discret">{inscrits.length} élève(s) · {inaptes} inapte(s)</span>
            <div className="espace" />
            <button className="btn-contour" onClick={() => window.print()}>Imprimer</button>
            {modifiable && <button className="btn" onClick={enregistrer}>Enregistrer</button>}
          </div>
          {msg && <p className="succes non-imprime">{msg}</p>}
          <table className="tableau doc">
            <thead><tr><th>N°</th><th>Nom et prénoms</th><th>Sexe</th><th>Né(e) le</th><th>Apte</th><th>Taille (cm)</th><th>Poids (kg)</th><th>Motif d'inaptitude</th>{modifiable && <th className="non-imprime"></th>}</tr></thead>
            <tbody>
              {inscrits.map((i, n) => {
                const f = fiches[i.id];
                if (!f) return null;
                return (
                  <tr key={i.id}>
                    <td>{n + 1}</td>
                    <td className="nom">{nomComplet(i.eleves)}</td>
                    <td>{i.eleves.sexe}</td>
                    <td>{dateFr(i.eleves.date_naissance)}</td>
                    <td><input type="checkbox" disabled={!modifiable} checked={!!f.apte} onChange={(e) => maj(i.id, 'apte', e.target.checked)} /> <span className="imprime-seul">{f.apte ? 'Apte' : 'Inapte'}</span></td>
                    <td><input className="petit" type="number" disabled={!modifiable} value={f.taille_cm ?? ''} onChange={(e) => maj(i.id, 'taille_cm', e.target.value)} /></td>
                    <td><input className="petit" type="number" disabled={!modifiable} value={f.poids_kg ?? ''} onChange={(e) => maj(i.id, 'poids_kg', e.target.value)} /></td>
                    <td><input disabled={!modifiable || f.apte} value={f.motif_inaptitude ?? ''} onChange={(e) => maj(i.id, 'motif_inaptitude', e.target.value)} /></td>
                    {modifiable && (
                      <td className="actions-ligne non-imprime">
                        {f.id && <button className="lien danger" onClick={() => effacerFiche(i)}>Supprimer la fiche</button>}
                        <button className="lien danger" onClick={() => retirerEleve(i)}>Supprimer l'élève</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="signatures imprime-seul"><div>Le maître</div><div>Le directeur</div><div>Le médecin / infirmier</div></div>
        </div>
      )}
    </div>
  );
}
