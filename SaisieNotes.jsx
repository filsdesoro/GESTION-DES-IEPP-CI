import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur, uid } from './supabase';
import { ChoixEcoleClasse, fmt, nomComplet, useListe } from './Choix.jsx';
import { useInscrits } from './Eleves.jsx';
import { libelleComposition } from './Compositions.jsx';
import Modal from './Modal.jsx';

/** Appréciation selon la moyenne sur 10 (identique au calcul de la base). */
export function appreciationMoyenne(m) {
  if (m === null || m === undefined || m === '') return '';
  const n = Number(m);
  if (n >= 9) return 'Excellent';
  if (n >= 8) return 'Très bien';
  if (n >= 7) return 'Bien';
  if (n >= 6) return 'Assez bien';
  if (n >= 5) return 'Passable';
  if (n >= 4) return 'Insuffisant';
  return 'Très insuffisant';
}

const versListe = (rows, cle) => (rows || []).filter((r) => r.matieres)
  .map((r) => ({ ...r.matieres, note_sur: Number(r.note_sur), coefficient: Number(r.coefficient), ordreClasse: r.ordre ?? r.matieres.ordre }))
  .sort((a, b) => (a[cle] ?? 0) - (b[cle] ?? 0));

/** Barème d'un niveau (paramétrage général). */
export function useBareme(niveau) {
  const [liste, setListe] = useState([]);
  useEffect(() => {
    if (!niveau) { setListe([]); return; }
    supabase.from('matieres_niveaux').select('note_sur, coefficient, matieres(id, code, libelle, ordre)').eq('niveau_code', niveau)
      .then(({ data }) => setListe(versListe(data, 'ordre')));
  }, [niveau]);
  return liste;
}

/**
 * Matières d'une classe : celles choisies par l'enseignant, sinon le barème du niveau.
 * Retourne [matieres, propres (bool), recharger]
 */
export function useMatieresClasse(classeId, niveau) {
  const [etat, setEtat] = useState({ liste: [], propres: false });
  const charger = useCallback(async () => {
    if (!classeId) { setEtat({ liste: [], propres: false }); return; }
    const { data } = await supabase.from('matieres_classe').select('note_sur, coefficient, ordre, matieres(id, code, libelle, ordre)').eq('classe_id', classeId);
    if (data && data.length) { setEtat({ liste: versListe(data, 'ordreClasse'), propres: true }); return; }
    if (!niveau) { setEtat({ liste: [], propres: false }); return; }
    const { data: niv } = await supabase.from('matieres_niveaux').select('note_sur, coefficient, matieres(id, code, libelle, ordre)').eq('niveau_code', niveau);
    setEtat({ liste: versListe(niv, 'ordre'), propres: false });
  }, [classeId, niveau]);
  useEffect(() => { charger(); }, [charger]);
  return [etat.liste, etat.propres, charger];
}

/** Calcul (identique à la base) : total, moyenne /10, rang, appréciation. */
export function calculerClasse(inscrits, matieres, valeurs) {
  const lignes = inscrits.map((i) => {
    let total = 0; let pondere = 0; let coefs = 0; let compte = 0;
    matieres.forEach((m) => {
      const v = valeurs[`${i.id}|${m.id}`];
      if (v === undefined || v === '' || v === 'ABS') return;
      const n = Number(v);
      if (Number.isNaN(n) || n < 0 || n > m.note_sur) return;
      total += n * m.coefficient; pondere += (n / m.note_sur) * 10 * m.coefficient; coefs += m.coefficient; compte += 1;
    });
    const moyenne = coefs ? Math.round((pondere / coefs) * 100) / 100 : null;
    return { id: i.id, total: compte ? total : null, moyenne };
  });
  const tries = lignes.filter((l) => l.moyenne !== null).sort((a, b) => b.moyenne - a.moyenne);
  const rang = {};
  tries.forEach((l, k) => { rang[l.id] = k > 0 && tries[k - 1].moyenne === l.moyenne ? rang[tries[k - 1].id] : k + 1; });
  return Object.fromEntries(lignes.map((l) => [l.id, { ...l, rang: rang[l.id] || null, appreciation: appreciationMoyenne(l.moyenne) }]));
}

export default function SaisieNotes() {
  const { id } = useParams();
  const { profil, role } = useApp();
  const [compo, setCompo] = useState(null);
  const [choix, setChoix] = useState({ ecoleId: null, classeId: null });
  const [classe, setClasse] = useState(null);
  const [inscrits] = useInscrits(choix.classeId);
  const [matieres, propres, rechargerMatieres] = useMatieresClasse(choix.classeId, classe?.niveau_code);
  const [valeurs, setValeurs] = useState({});
  const [modifie, setModifie] = useState(false);
  const [msg, setMsg] = useState({ t: '', ok: true });
  const [envoi, setEnvoi] = useState(false);
  const [gestionMatieres, setGestionMatieres] = useState(false);
  const [matiereId, setMatiereId] = useState('');

  useEffect(() => {
    supabase.from('compositions').select('*').eq('id', id).maybeSingle().then(({ data }) => setCompo(data));
  }, [id]);

  const chargerNotes = useCallback(async () => {
    if (!choix.classeId || !inscrits.length) { setValeurs({}); return; }
    const ids = inscrits.map((i) => i.id);
    const { data } = await supabase.from('notes').select('inscription_id, matiere_id, note, absent').eq('composition_id', id).in('inscription_id', ids);
    const v = {};
    (data || []).forEach((n) => { v[`${n.inscription_id}|${n.matiere_id}`] = n.absent ? 'ABS' : n.note === null ? '' : String(Number(n.note)); });
    setValeurs(v);
    setModifie(false);
  }, [choix.classeId, inscrits, id]);
  useEffect(() => { chargerNotes(); }, [chargerNotes]);

  const calculs = useMemo(() => calculerClasse(inscrits, matieres, valeurs), [inscrits, matieres, valeurs]);
  // Saisie matière par matière : la première matière est proposée par défaut
  useEffect(() => {
    if (matiereId !== 'toutes' && !matieres.some((m) => m.id === matiereId)) setMatiereId(matieres[0]?.id || '');
  }, [matieres]); // eslint-disable-line react-hooks/exhaustive-deps
  const affichees = matiereId && matiereId !== 'toutes' ? matieres.filter((m) => m.id === matiereId) : matieres;
  const saisiesMatiere = (m) => inscrits.filter((i) => (valeurs[`${i.id}|${m.id}`] ?? '') !== '').length;
  const rangMatiere = matieres.findIndex((m) => m.id === matiereId);

  if (!compo) return <p className="discret">Chargement…</p>;
  const verrou = !compo.saisie_ouverte && role !== 'superviseur';
  const peutMatieres = role !== 'conseiller' && !verrou;

  function changer(cle, val) {
    setValeurs((v) => ({ ...v, [cle]: val.toUpperCase() === 'A' || val.toUpperCase() === 'ABS' ? 'ABS' : val.replace(',', '.') }));
    setModifie(true);
  }

  function erreurCellule(m, val) {
    if (val === undefined || val === '' || val === 'ABS') return false;
    const n = Number(val);
    return Number.isNaN(n) || n < 0 || n > m.note_sur;
  }

  async function enregistrer() {
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
    // Calcul automatique : total, moyenne, rang, appréciation, puis bilan annuel
    const { error } = await supabase.rpc('calculer_resultats', { p_composition: id, p_classe: choix.classeId });
    setEnvoi(false);
    if (error) return setMsg({ t: traduireErreur(error), ok: false });
    setMsg({ t: 'Notes enregistrées. Total, moyenne, rang, appréciation et décision de fin d’année mis à jour.', ok: true });
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

  const nbSaisies = Object.entries(valeurs).filter(([k, v]) => v !== '' && matieres.some((m) => k.endsWith(`|${m.id}`))).length;
  const nbAttendues = inscrits.length * matieres.length;

  return (
    <div>
      <p><Link to="/compositions">← Compositions</Link></p>
      <h1>Saisie des notes — {libelleComposition(compo)}</h1>
      {verrou && <div className="alerte">La saisie est fermée pour cette composition. Les notes sont en lecture seule.</div>}
      <ChoixEcoleClasse valeur={choix} niveaux={compo.niveaux} changer={(v, c) => { if (modifie && !confirm('Des notes non enregistrées seront perdues. Continuer ?')) return; setChoix(v); setClasse(c); }} />
      {!classe ? <p className="vide">Choisissez l'école et la classe.</p> : (
        <>
          <div className="carte bandeau-matieres">
            <div>
              <b>Matières de la classe {classe.nom}</b>
              <span className="discret"> — {propres ? 'choisies par l’enseignant' : matieres.length ? `barème général du niveau ${classe.niveau_code}` : 'aucune matière'}</span>
              <div className="etiquettes" style={{ marginTop: 6 }}>
                {matieres.map((m) => <span key={m.id} className="badge">{m.libelle} /{m.note_sur}{m.coefficient !== 1 ? ` ×${m.coefficient}` : ''}</span>)}
              </div>
            </div>
            {peutMatieres && <button className="btn-contour" onClick={() => setGestionMatieres(true)}>Choisir les matières</button>}
          </div>

          {matieres.length === 0 ? (
            <p className="alerte">Aucune matière pour cette classe. Cliquez sur « Choisir les matières » pour les ajouter, avec la note maximale et le coefficient.</p>
          ) : (
            <>
              <div className="choix-ligne choix-matiere">
                <label>Matière à saisir
                  <select value={matiereId} onChange={(e) => setMatiereId(e.target.value)}>
                    {matieres.map((m) => {
                      const n = saisiesMatiere(m);
                      return <option key={m.id} value={m.id}>{n === inscrits.length && n > 0 ? '✓ ' : ''}{m.libelle} (/{m.note_sur}) — {n}/{inscrits.length} saisie(s)</option>;
                    })}
                    <option value="toutes">Toutes les matières (tableau complet)</option>
                  </select>
                </label>
                {rangMatiere >= 0 && rangMatiere < matieres.length - 1 && (
                  <button type="button" className="btn-contour" onClick={() => setMatiereId(matieres[rangMatiere + 1].id)}>Matière suivante → {matieres[rangMatiere + 1].libelle}</button>
                )}
              </div>
              <div className="barre-outils">
                <span className="discret">Tapez la note, ou <b>A</b> pour absent. Entrée = élève suivant. Le total, la moyenne, le rang et l'appréciation se calculent automatiquement. Saisie : {nbSaisies}/{nbAttendues}</span>
                <div className="espace" />
                {!verrou && <button className="btn" disabled={envoi} onClick={enregistrer}>{envoi ? 'Enregistrement…' : 'Enregistrer les notes'}</button>}
              </div>
              {msg.t && <p className={msg.ok ? 'succes' : 'erreur'}>{msg.t}</p>}
              <div className="tableau-cadre">
                <table className="tableau saisie">
                  <thead>
                    <tr>
                      <th>N°</th><th>Élève</th>
                      {affichees.map((m) => <th key={m.id} title={m.libelle} className={affichees.length === 1 ? 'colonne-matiere' : ''}>{affichees.length === 1 || m.libelle.length <= 14 ? m.libelle : m.code}<div className="discret">/{m.note_sur}{m.coefficient !== 1 ? ` ×${m.coefficient}` : ''}</div></th>)}
                      <th className="calcule">Total</th><th className="calcule">Moy./10</th><th className="calcule">Rang</th><th className="calcule">Appréciation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inscrits.length === 0 && <tr><td colSpan={affichees.length + 6} className="vide">Aucun élève dans cette classe.</td></tr>}
                    {inscrits.map((i, r) => {
                      const k = calculs[i.id] || {};
                      return (
                        <tr key={i.id}>
                          <td>{r + 1}</td>
                          <td className="nom">{nomComplet(i.eleves)}</td>
                          {affichees.map((m, c) => {
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
                          <td className="calcule">{fmt(k.total)}</td>
                          <td className="calcule"><b>{fmt(k.moyenne)}</b></td>
                          <td className="calcule">{k.rang ? `${k.rang}${k.rang === 1 ? 'er' : 'e'}` : ''}</td>
                          <td className="calcule">{k.appreciation}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      {gestionMatieres && classe && (
        <GestionMatieres classe={classe} matieres={matieres} propres={propres}
          fermer={() => setGestionMatieres(false)} apres={() => { rechargerMatieres(); setGestionMatieres(false); }} />
      )}
    </div>
  );
}

/** Fenêtre de choix des matières d'une classe par l'enseignant. */
function GestionMatieres({ classe, matieres, fermer, apres }) {
  const catalogue = useListe('matieres', { select: 'id, code, libelle, ordre, actif', ordre: 'libelle' });
  const [lignes, setLignes] = useState(() => matieres.map((m, k) => ({ id: m.id, libelle: m.libelle, note_sur: m.note_sur, coefficient: m.coefficient, ordre: k })));
  const [ajout, setAjout] = useState('');
  const [nouvelle, setNouvelle] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const disponibles = catalogue.filter((m) => m.actif !== false && !lignes.some((l) => l.id === m.id));
  const maj = (k, champ, v) => setLignes((ls) => ls.map((l, j) => (j === k ? { ...l, [champ]: v } : l)));
  const deplacer = (k, d) => setLignes((ls) => { const c = [...ls]; const j = k + d; if (j < 0 || j >= c.length) return ls; [c[k], c[j]] = [c[j], c[k]]; return c; });

  function ajouter() {
    const m = catalogue.find((x) => x.id === ajout);
    if (!m) return;
    setLignes((ls) => [...ls, { id: m.id, libelle: m.libelle, note_sur: 10, coefficient: 1 }]);
    setAjout('');
  }

  async function creer() {
    const nom = nouvelle.trim();
    if (!nom) return;
    setErreur('');
    const existe = catalogue.find((m) => m.libelle.toLowerCase() === nom.toLowerCase());
    if (existe) { setLignes((ls) => (ls.some((l) => l.id === existe.id) ? ls : [...ls, { id: existe.id, libelle: existe.libelle, note_sur: 10, coefficient: 1 }])); setNouvelle(''); return; }
    const code = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 20) + '_' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const mid = uid();
    const { error } = await supabase.from('matieres').insert({ id: mid, code, libelle: nom, ordre: 50 });
    if (error) return setErreur(traduireErreur(error));
    setLignes((ls) => [...ls, { id: mid, libelle: nom, note_sur: 10, coefficient: 1 }]);
    setNouvelle('');
  }

  async function enregistrer() {
    setErreur('');
    for (const l of lignes) {
      if (!(Number(l.note_sur) > 0)) return setErreur(`« ${l.libelle} » : la note maximale doit être supérieure à 0.`);
      if (!(Number(l.coefficient) > 0)) return setErreur(`« ${l.libelle} » : le coefficient doit être supérieur à 0.`);
    }
    setEnvoi(true);
    const del = await supabase.from('matieres_classe').delete().eq('classe_id', classe.id);
    if (del.error) { setEnvoi(false); return setErreur(traduireErreur(del.error)); }
    if (lignes.length) {
      const { error } = await supabase.from('matieres_classe').insert(lignes.map((l, k) => ({
        classe_id: classe.id, matiere_id: l.id, note_sur: Number(l.note_sur), coefficient: Number(l.coefficient), ordre: k,
      })));
      if (error) { setEnvoi(false); return setErreur(traduireErreur(error)); }
    }
    setEnvoi(false);
    apres();
  }

  return (
    <Modal titre={`Matières de la classe ${classe.nom}`} fermer={fermer} large>
      <div className="formulaire">
        <p className="discret">Choisissez les matières évaluées dans cette classe, la note maximale (« sur ») et le coefficient. Ces choix remplacent le barème général pour cette classe.</p>
        <table className="tableau">
          <thead><tr><th>Ordre</th><th>Matière</th><th>Note sur</th><th>Coefficient</th><th /></tr></thead>
          <tbody>
            {lignes.length === 0 && <tr><td colSpan={5} className="vide">Aucune matière. Ajoutez-en ci-dessous.</td></tr>}
            {lignes.map((l, k) => (
              <tr key={l.id}>
                <td className="actions-ligne" style={{ textAlign: 'left' }}>
                  <button className="lien" disabled={k === 0} onClick={() => deplacer(k, -1)} title="Monter">▲</button>
                  <button className="lien" disabled={k === lignes.length - 1} onClick={() => deplacer(k, 1)} title="Descendre">▼</button>
                </td>
                <td><b>{l.libelle}</b></td>
                <td><input className="petit" type="number" min="1" value={l.note_sur} onChange={(e) => maj(k, 'note_sur', e.target.value)} /></td>
                <td><input className="petit" type="number" min="0.5" step="0.5" value={l.coefficient} onChange={(e) => maj(k, 'coefficient', e.target.value)} /></td>
                <td><button className="lien danger" onClick={() => setLignes((ls) => ls.filter((_, j) => j !== k))}>Retirer</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="choix-ligne">
          <label>Ajouter une matière existante
            <select value={ajout} onChange={(e) => setAjout(e.target.value)}>
              <option value="">— choisir —</option>
              {disponibles.map((m) => <option key={m.id} value={m.id}>{m.libelle}</option>)}
            </select>
          </label>
          <button className="btn-contour" disabled={!ajout} onClick={ajouter}>Ajouter</button>
        </div>
        <div className="choix-ligne">
          <label>Ou créer une nouvelle matière
            <input value={nouvelle} placeholder="ex. Lecture, Écriture, Dessin…" onChange={(e) => setNouvelle(e.target.value)} />
          </label>
          <button className="btn-contour" disabled={!nouvelle.trim()} onClick={creer}>Créer et ajouter</button>
        </div>
        {erreur && <p className="erreur">{erreur}</p>}
        <div className="actions">
          <button className="btn-contour" onClick={fermer}>Annuler</button>
          <button className="btn" disabled={envoi} onClick={enregistrer}>{envoi ? 'Enregistrement…' : 'Enregistrer les matières'}</button>
        </div>
      </div>
    </Modal>
  );
}
