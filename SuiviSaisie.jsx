import { useEffect, useMemo, useState } from 'react';
import { useApp } from './contexte.jsx';
import { supabase } from './supabase';
import { fmt, useListe } from './Choix.jsx';
import { ChoixComposition, useCompositions } from './Compositions.jsx';
import { signalerSuppression, supprimerNotes } from './Corbeille.jsx';

export default function SuiviSaisie() {
  const { ieppId, profil, peutGerer } = useApp();
  const [recharge, setRecharge] = useState(0);
  const [compos] = useCompositions();
  const [compoId, setCompoId] = useState('');
  const [lignes, setLignes] = useState([]);
  const [secteur, setSecteur] = useState(profil.role === 'conseiller' ? profil.secteur_id : '');
  const [seulIncomplet, setSeulIncomplet] = useState(false);
  const secteurs = useListe('secteurs', { filtre: { iepp_id: ieppId }, ordre: 'nom' });

  useEffect(() => { if (!compoId && compos.length) setCompoId((compos.filter((c) => c.saisie_ouverte).pop() || compos[compos.length - 1]).id); }, [compos, compoId]);
  useEffect(() => {
    if (!compoId) return;
    supabase.from('v_suivi_saisie').select('*').eq('composition_id', compoId).order('ecole').then(({ data }) => setLignes(data || []));
  }, [compoId, recharge]);

  async function effacerNotes(c) {
    if (!confirm(`Supprimer toutes les notes saisies de la classe ${c.classe} (${c.ecole}) pour cette composition ?\n(Vous pourrez annuler, ou les restaurer depuis la Corbeille.)`)) return;
    const err = await supprimerNotes(compoId, c.classe_id);
    if (err) return alert(err);
    signalerSuppression(`Notes de ${c.classe} — ${c.ecole}`);
    setRecharge((n) => n + 1);
  }

  // Regroupement par école
  const ecoles = useMemo(() => {
    const g = {};
    lignes.filter((l) => !secteur || l.secteur_id === secteur).forEach((l) => {
      const e = g[l.ecole_id] || { nom: l.ecole, secteur_id: l.secteur_id, classes: [], attendues: 0, saisies: 0 };
      e.classes.push(l);
      e.attendues += l.nb_eleves * l.nb_matieres;
      e.saisies += l.nb_notes_saisies;
      g[l.ecole_id] = e;
    });
    return Object.entries(g).map(([id, e]) => ({ id, ...e, taux: e.attendues ? (100 * e.saisies) / e.attendues : 0 }))
      .filter((e) => !seulIncomplet || e.taux < 100)
      .sort((a, b) => a.taux - b.taux);
  }, [lignes, secteur, seulIncomplet]);

  const global = ecoles.reduce((s, e) => ({ a: s.a + e.attendues, s: s.s + e.saisies }), { a: 0, s: 0 });
  const nomSecteur = (id) => secteurs.find((s) => s.id === id)?.nom || '';
  const couleur = (t) => (t >= 100 ? 'vert' : t >= 50 ? 'orange' : 'rouge');

  return (
    <div>
      <h1>Suivi de la saisie</h1>
      <div className="choix-ligne">
        <ChoixComposition compos={compos} valeur={compoId} changer={setCompoId} />
        {profil.role !== 'conseiller' && (
          <label>Secteur
            <select value={secteur} onChange={(e) => setSecteur(e.target.value)}>
              <option value="">Tous les secteurs</option>
              {secteurs.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
            </select>
          </label>
        )}
        <label className="case"><input type="checkbox" checked={seulIncomplet} onChange={(e) => setSeulIncomplet(e.target.checked)} /> Écoles en retard seulement</label>
      </div>
      {compos.length === 0 ? <p className="vide">Aucune composition programmée.</p> : (
        <>
          <div className="carte progression-globale">
            <b>Avancement global : {global.a ? `${fmt((100 * global.s) / global.a, 1)} %` : '—'}</b>
            <div className="jauge"><span className={couleur(global.a ? (100 * global.s) / global.a : 0)} style={{ width: `${global.a ? (100 * global.s) / global.a : 0}%` }} /></div>
            <span className="discret">{global.s.toLocaleString('fr-FR')} notes saisies sur {global.a.toLocaleString('fr-FR')} attendues · {ecoles.filter((e) => e.taux >= 100).length}/{ecoles.length} écoles terminées</span>
          </div>
          <div className="tableau-cadre">
            <table className="tableau">
              <thead><tr><th>École</th><th>Secteur</th><th>Classes</th><th>Avancement</th><th>Détail par classe</th></tr></thead>
              <tbody>
                {ecoles.length === 0 && <tr><td colSpan={5} className="vide">Aucune classe concernée (vérifiez les classes, les élèves inscrits et le barème).</td></tr>}
                {ecoles.map((e) => (
                  <tr key={e.id}>
                    <td><b>{e.nom}</b></td>
                    <td>{nomSecteur(e.secteur_id)}</td>
                    <td>{e.classes.length}</td>
                    <td style={{ minWidth: 160 }}>
                      <div className="jauge"><span className={couleur(e.taux)} style={{ width: `${e.taux}%` }} /></div>
                      <small>{fmt(e.taux, 0)} %</small>
                    </td>
                    <td className="etiquettes">{e.classes.map((c) => (
                      <span key={c.classe_id} className={`badge ${couleur(Number(c.taux_saisie) || 0)}`}>{c.classe} {fmt(c.taux_saisie, 0) || 0}%
                        {peutGerer && c.nb_notes_saisies > 0 && <button className="croix-suppr" title={`Supprimer les notes de ${c.classe}`} onClick={() => effacerNotes(c)}>✕</button>}
                      </span>
                    ))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
