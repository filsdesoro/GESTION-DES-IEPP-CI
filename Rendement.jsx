import { useEffect, useMemo, useState } from 'react';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
import { nomComplet, useEcoles } from './Choix.jsx';
import { libelleComposition, useCompositions } from './Compositions.jsx';

const ANNUELLE = 'annuelle';
const fmt = (m) => (m == null ? '—' : Number(m).toFixed(2).replace('.', ','));
const parNom = (a, b) => a.nom.localeCompare(b.nom, 'fr');

/** Élève(s) ayant la moyenne la plus haute (sens = 1) ou la plus basse (sens = -1) — ex aequo compris. */
function extremes(liste, sens) {
  if (!liste.length) return [];
  const cible = sens > 0 ? Math.max(...liste.map((e) => e.moyenne)) : Math.min(...liste.map((e) => e.moyenne));
  return liste.filter((e) => e.moyenne === cible).sort(parNom);
}

export default function Rendement() {
  const { annee, iepp } = useApp();
  const ecoles = useEcoles();
  const [compos] = useCompositions();
  const [ecoleId, setEcoleId] = useState('');
  const [periode, setPeriode] = useState(ANNUELLE);
  const [classeId, setClasseId] = useState('');
  const [eleves, setEleves] = useState(null);
  const [erreur, setErreur] = useState('');
  const seuil = Number(iepp?.seuil_passage ?? 5);

  useEffect(() => { if (!ecoleId && ecoles.length === 1) setEcoleId(ecoles[0].id); }, [ecoles]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setEleves(null); setErreur('');
    if (!ecoleId || !annee) return;
    let annule = false;
    (async () => {
      const champsEleve = 'id, classe_id, eleves(nom, prenoms, sexe), classes!inner(nom, niveau_code, ecole_id)';
      let res;
      if (periode === ANNUELLE) {
        res = await supabase.from('inscriptions').select(`moyenne_annuelle, ${champsEleve}`)
          .eq('annee_id', annee.id).eq('classes.ecole_id', ecoleId);
      } else {
        res = await supabase.from('resultats_composition').select(`moyenne, inscriptions!inner(${champsEleve})`)
          .eq('composition_id', periode).eq('inscriptions.classes.ecole_id', ecoleId);
      }
      if (annule) return;
      if (res.error) { setErreur(traduireErreur(res.error)); return; }
      setEleves((res.data || []).map((r) => {
        const i = periode === ANNUELLE ? r : r.inscriptions;
        return {
          id: i.id, classe_id: i.classe_id, classe: i.classes?.nom || '', niveau: i.classes?.niveau_code || '',
          nom: nomComplet(i.eleves), sexe: i.eleves?.sexe || '',
          moyenne: (periode === ANNUELLE ? r.moyenne_annuelle : r.moyenne) == null ? null : Number(periode === ANNUELLE ? r.moyenne_annuelle : r.moyenne),
        };
      }));
    })();
    return () => { annule = true; };
  }, [ecoleId, periode, annee]);

  const classes = useMemo(() => {
    const m = new Map();
    (eleves || []).forEach((e) => m.set(e.classe_id, e.classe));
    return [...m].map(([id, nom]) => ({ id, nom })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }));
  }, [eleves]);
  useEffect(() => { if (classeId && !classes.some((c) => c.id === classeId)) setClasseId(''); }, [classes]); // eslint-disable-line react-hooks/exhaustive-deps

  const retenus = (eleves || []).filter((e) => !classeId || e.classe_id === classeId);
  const notes = retenus.filter((e) => e.moyenne != null);
  const sansMoyenne = retenus.length - notes.length;
  const admis = notes.filter((e) => e.moyenne >= seuil).sort((a, b) => b.moyenne - a.moyenne || parNom(a, b));
  const nonAdmis = notes.filter((e) => e.moyenne < seuil).sort((a, b) => b.moyenne - a.moyenne || parNom(a, b));
  const taux = notes.length ? Math.round((1000 * admis.length) / notes.length) / 10 : 0;

  const classesNotees = [...new Set(notes.map((e) => e.classe_id))]
    .map((id) => ({ id, nom: notes.find((e) => e.classe_id === id).classe, eleves: notes.filter((e) => e.classe_id === id) }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }));
  const nomEcole = ecoles.find((e) => e.id === ecoleId)?.nom || '';
  const portee = classeId ? `de la classe ${classes.find((c) => c.id === classeId)?.nom || ''}` : "de l'école";
  const libellePeriode = periode === ANNUELLE ? 'Moyenne annuelle' : libelleComposition(compos.find((c) => c.id === periode) || {});

  return (
    <div className="rendement">
      <div className="titre-ligne">
        <h1>Rendement des élèves</h1>
        <button className="btn-contour non-imprime" disabled={!notes.length} onClick={() => { document.querySelectorAll('details.liste-deroulante').forEach((d) => { d.open = true; }); setTimeout(() => window.print(), 50); }}>Imprimer</button>
      </div>
      <p className="imprime-seul"><strong>{nomEcole}</strong> — {libellePeriode} — {annee?.libelle}</p>

      <div className="choix-ligne">
        <label>École
          <select value={ecoleId} onChange={(e) => setEcoleId(e.target.value)}>
            <option value="">— choisir une école —</option>
            {ecoles.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
          </select>
        </label>
        <label>Période
          <select value={periode} onChange={(e) => setPeriode(e.target.value)}>
            <option value={ANNUELLE}>Moyenne annuelle (bilan de fin d'année)</option>
            {compos.length > 0 && <option disabled>──────────</option>}
            {compos.map((c) => <option key={c.id} value={c.id}>{libelleComposition(c)}</option>)}
          </select>
        </label>
        <label>Classe
          <select value={classeId} onChange={(e) => setClasseId(e.target.value)} disabled={!classes.length}>
            <option value="">Toutes les classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </label>
      </div>

      {erreur && <p className="erreur">{erreur}</p>}
      {!ecoleId && <p className="vide carte">Choisissez une école.</p>}
      {ecoleId && !eleves && !erreur && <p className="discret">Chargement…</p>}
      {eleves && !notes.length && (
        <p className="vide carte">
          Aucune moyenne disponible pour ce choix.
          {periode === ANNUELLE ? ' Les moyennes annuelles apparaissent après la saisie des notes des compositions mensuelles.' : ' Les notes de cette composition n’ont pas encore été enregistrées.'}
        </p>
      )}

      {notes.length > 0 && (
        <>
          <div className="grille-stats">
            <div className="carte stat"><span>Élèves classés</span><strong>{notes.length}</strong>{sansMoyenne > 0 && <small>{sansMoyenne} sans moyenne</small>}</div>
            <div className="carte stat vert"><span>Ont la moyenne (≥ {fmt(seuil)})</span><strong>{admis.length}</strong></div>
            <div className="carte stat rouge"><span>N'ont pas la moyenne</span><strong>{nonAdmis.length}</strong></div>
            <div className="carte stat"><span>Taux de réussite</span><strong>{String(taux).replace('.', ',')} %</strong></div>
          </div>

          <ListeDeroulante titre={`Élèves ayant la moyenne et plus (≥ ${fmt(seuil)}/10)`} liste={admis} classe="ok" />
          <ListeDeroulante titre={`Élèves n'ayant pas la moyenne (< ${fmt(seuil)}/10)`} liste={nonAdmis} classe="ko" />

          <div className="deux-colonnes">
            <Extremes titre="Meilleurs élèves" sous="Plus forte moyenne" sens={1} notes={notes} classesNotees={classesNotees} portee={portee} />
            <Extremes titre="Élèves les plus faibles" sous="Moyenne la plus basse" sens={-1} notes={notes} classesNotees={classesNotees} portee={portee} />
          </div>
        </>
      )}
    </div>
  );
}

function ListeDeroulante({ titre, liste, classe }) {
  return (
    <details className={`carte liste-deroulante ${classe}`}>
      <summary><span>{titre}</span><span className="compteur">{liste.length} élève{liste.length > 1 ? 's' : ''}</span></summary>
      {liste.length ? (
        <div className="tableau-cadre"><table className="tableau">
          <thead><tr><th>N°</th><th>Nom et prénoms</th><th>Sexe</th><th>Classe</th><th className="nombre">Moyenne /10</th></tr></thead>
          <tbody>
            {liste.map((e, i) => (
              <tr key={e.id}><td>{i + 1}</td><td>{e.nom}</td><td>{e.sexe}</td><td>{e.classe}</td><td className="nombre"><strong>{fmt(e.moyenne)}</strong></td></tr>
            ))}
          </tbody>
        </table></div>
      ) : <p className="vide">Aucun élève.</p>}
    </details>
  );
}

function Noms({ liste }) {
  if (!liste.length) return <span className="discret">—</span>;
  return liste.map((e) => <div key={e.id}><strong>{e.nom}</strong> <span className="discret">({e.classe})</span></div>);
}

function Extremes({ titre, sous, sens, notes, classesNotees, portee }) {
  const ecole = extremes(notes, sens);
  const garcons = extremes(notes.filter((e) => e.sexe === 'M'), sens);
  const filles = extremes(notes.filter((e) => e.sexe === 'F'), sens);
  const ligne = (libelle, liste) => (
    <tr key={libelle}><td>{libelle}</td><td><Noms liste={liste} /></td><td className="nombre">{liste.length ? fmt(liste[0].moyenne) : '—'}</td></tr>
  );
  return (
    <section className={`carte extremes ${sens > 0 ? 'meilleurs' : 'faibles'}`}>
      <h2>{titre}</h2>
      <p className="discret">{sous}{ecole.length > 1 || garcons.length > 1 || filles.length > 1 ? ' — les ex aequo sont tous affichés' : ''}</p>

      <h3>{sens > 0 ? 'Major' : 'Plus faible'} {portee}</h3>
      <table className="tableau"><tbody>{ligne(sens > 0 ? 'Premier' : 'Dernier', ecole)}</tbody></table>

      <h3>Par sexe</h3>
      <table className="tableau">
        <thead><tr><th>Sexe</th><th>Élève</th><th className="nombre">Moyenne</th></tr></thead>
        <tbody>{ligne('Garçons', garcons)}{ligne('Filles', filles)}</tbody>
      </table>

      <h3>Par classe</h3>
      <table className="tableau">
        <thead><tr><th>Classe</th><th>Élève</th><th className="nombre">Moyenne</th></tr></thead>
        <tbody>{classesNotees.map((c) => ligne(c.nom, extremes(c.eleves, sens)))}</tbody>
      </table>
    </section>
  );
}

