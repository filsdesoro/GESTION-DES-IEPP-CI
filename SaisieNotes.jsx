import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
import { ChoixEcoleClasse, fmt, nomComplet } from './Choix.jsx';
import { useInscrits } from './Eleves.jsx';

/** Matières évaluées pour un niveau, avec barème. */
export function useBareme(niveau) {
  const [liste, setListe] = useState([]);
  useEffect(() => {
    if (!niveau) { setListe([]); return; }
    supabase.from('matieres_niveaux').select('note_sur, coefficient, matieres(id, code, libelle, ordre)').eq('niveau_code', niveau)
      .then(({ data }) => setListe((data || []).filter((r) => r.matieres).map((r) => ({ ...r.matieres, note_sur: Number(r.note_sur), coefficient: Number(r.coefficient) })).sort((a, b) => a.ordre - b.ordre)));
  }, [niveau]);
  return liste;
}

export default function SaisieNotes() {
  const { id } = useParams();
  const { profil, role } = useApp();
  const [compo, setCompo] = useState(null);
  const [choix, setChoix] = useState({ ecoleId: null, classeId: null });
  const [classe, setClasse] = useState(null);
  const [inscrits] = useInscrits(choix.classeId);
  const matieres = useBareme(classe?.niveau_code);
  const [valeurs, setValeurs] = useState({});
  const [modifie, setModifie] = useState(false);
  const [resultats, setResultats] = useState({});
  const [msg, setMsg] = useState({ t: '', ok: true });
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    supabase.from('compositions').select('*').eq('id', id).maybeSingle().then(({ data }) => setCompo(data));
  }, [id]);

  const chargerNotes = useCallback(async () => {
    if (!choix.classeId || !inscrits.length) { setValeurs({}); setResultats({}); return; }
    const ids = inscrits.map((i) => i.id);
    const { data } = await supabase.from('notes').select('inscription_id, matiere_id, note, absent').eq('composition_id', id).in('inscription_id', ids);
    const v = {};
    (data || []).forEach((n) => { v[`${n.inscription_id}|${n.matiere_id}`] = n.absent ? 'ABS' : (n.note ?? '') === '' ? '' : String(n.note); });
    setValeurs(v);
    setModifie(false);
    const { data: r } = await supabase.from('resultats_composition').select('*').eq('composition_id', id).in('inscription_id', ids);
    setResultats(Object.fromEntries((r || []).map((x) => [x.inscription_id, x])));
  }, [choix.classeId, inscrits, id]);
  useEffect(() => { chargerNotes(); }, [chargerNotes]);

  if (!compo) return <p className="discret">Chargement…</p>;
  const verrou = !compo.saisie_ouverte && role !== 'superviseur';

  function changer(cle, val) {
    setValeurs((v) => ({ ...v, [cle]: val.toUpperCase() === 'A' || val.toUpperCase() === 'ABS' ? 'ABS' : val.replace(',', '.') }));
    setModifie(true);
  }

  function erreurCellule(m, val) {
    if (val === undefined || val === '' || val === 'ABS') return false;
    const n = Number(val);
    return Number.isNaN(n) || n < 0 || n > m.note_sur;
  }

  async function enregistrer(calculer = false) {
    setMsg({ t: '', ok: true });
    const lignes = [];
    for (const i of inscrits) {
      for (const m of matieres) {
        const val = valeurs[`${i.id}|${m.id}`];
        if (val === undefined) continue;
        if (erreurCellule(m, val)) {
          setMsg({ t: `Note invalide pour ${nomComplet(i.eleves)} en ${m.libelle} (maximum ${m.note_sur}).`, ok: false });
          return;
        }
        lignes.push({
          composition_id: id, inscription_id: i.id, matiere_id: m.id,
          note: val === '' || val === 'ABS' ? null : Number(val), absent: val === 'ABS', saisie_par: profil.id,
        });
      }
    }
    setEnvoi(true);
    if (lignes.length) {
      const { error } = await supabase.from('notes').upsert(lignes, { onConflict: 'composition_id,inscription_id,matiere_id' });
      if (error) { setEnvoi(false); return setMsg({ t: traduireErreur(error), ok: false }); }
    }
    if (calculer) {
      const { error } = await supabase.rpc('calculer_resultats', { p_composition: id, p_classe: choix.classeId });
      if (error) { setEnvoi(false); return setMsg({ t: traduireErreur(error), ok: false }); }
    }
    setEnvoi(false);
    setMsg({ t: calculer ? 'Notes enregistrées, moyennes et rangs calculés.' : 'Notes enregistrées.', ok: true });
    chargerNotes();
  }

  function touche(e, r, c) {
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const cible = document.querySelector(`[data-cell="${r + (e.key === 'ArrowUp' ? -1 : 1)}-${c}"]`);
      cible?.focus();
      cible?.select();
    }
  }

  const nbSaisies = Object.values(valeurs).filter((v) => v !== '').length;
  const nbAttendues = inscrits.length * matieres.length;

  return (
    <div>
      <p><Link to="/compositions">← Compositions</Link></p>
      <h1>Saisie des notes — {compo.libelle}</h1>
      {verrou && <div className="alerte">La saisie est fermée pour cette composition. Les notes sont en lecture seule.</div>}
      <ChoixEcoleClasse valeur={choix} niveaux={compo.niveaux} changer={(v, c) => { if (modifie && !confirm('Des notes non enregistrées seront perdues. Continuer ?')) return; setChoix(v); setClasse(c); }} />
      {!classe ? <p className="vide">Choisissez l'école et la classe.</p> : matieres.length === 0 ? (
        <p className="alerte">Aucune matière n'est paramétrée pour le niveau {classe.niveau_code}. Le superviseur doit compléter le barème (Paramétrage → Barème des matières).</p>
      ) : (
        <>
          <div className="barre-outils">
            <span className="discret">Tapez la note, ou <b>A</b> pour absent. Entrée = élève suivant. Saisie : {nbSaisies}/{nbAttendues}</span>
            <div className="espace" />
            {!verrou && <button className="btn-contour" disabled={envoi} onClick={() => enregistrer(false)}>Enregistrer</button>}
            {!verrou && <button className="btn" disabled={envoi} onClick={() => enregistrer(true)}>Enregistrer et calculer les moyennes</button>}
          </div>
          {msg.t && <p className={msg.ok ? 'succes' : 'erreur'}>{msg.t}</p>}
          <div className="tableau-cadre">
            <table className="tableau saisie">
              <thead>
                <tr>
                  <th>N°</th><th>Élève</th>
                  {matieres.map((m) => <th key={m.id} title={m.libelle}>{m.code}<div className="discret">/{m.note_sur}{m.coefficient !== 1 ? ` ×${m.coefficient}` : ''}</div></th>)}
                  <th>Moy./10</th><th>Rang</th>
                </tr>
              </thead>
              <tbody>
                {inscrits.length === 0 && <tr><td colSpan={matieres.length + 4} className="vide">Aucun élève dans cette classe.</td></tr>}
                {inscrits.map((i, r) => (
                  <tr key={i.id}>
                    <td>{r + 1}</td>
                    <td className="nom">{nomComplet(i.eleves)}</td>
                    {matieres.map((m, c) => {
                      const cle = `${i.id}|${m.id}`;
                      const val = valeurs[cle] ?? '';
                      return (
                        <td key={m.id}>
                          <input data-cell={`${r}-${c}`} className={`note ${erreurCellule(m, val) ? 'invalide' : ''} ${val === 'ABS' ? 'abs' : ''}`}
                            value={val} disabled={verrou} inputMode="decimal"
                            onChange={(e) => changer(cle, e.target.value)} onKeyDown={(e) => touche(e, r, c)} onFocus={(e) => e.target.select()} />
                        </td>
                      );
                    })}
                    <td><b>{fmt(resultats[i.id]?.moyenne)}</b></td>
                    <td>{resultats[i.id]?.rang ?? ''}</td>
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
