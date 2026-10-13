import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur, uid } from './supabase';
import { FormulaireModal } from './Crud.jsx';
import { dateFr } from './Choix.jsx';

const NIVEAUX = ['PS', 'MS', 'GS', 'CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];
const PRIMAIRE = ['CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];
export const MAX_EXAMENS_BLANCS = 3;

// Mois de l'année scolaire, dans l'ordre (septembre → juillet)
export const MOIS = [
  [9, 'Septembre'], [10, 'Octobre'], [11, 'Novembre'], [12, 'Décembre'], [1, 'Janvier'], [2, 'Février'],
  [3, 'Mars'], [4, 'Avril'], [5, 'Mai'], [6, 'Juin'], [7, 'Juillet'],
];
const NOM_MOIS = Object.fromEntries(MOIS);
// Mois proposés par défaut pour la génération automatique (octobre → mai)
const MOIS_PAR_DEFAUT = [10, 11, 12, 1, 2, 3, 4, 5];

const rangMois = (m) => (m + 12 - 9) % 12; // septembre = 0
const deDevant = (nom) => (/^[AEIOUÉ]/i.test(nom) ? `d'${nom.toLowerCase()}` : `de ${nom.toLowerCase()}`);

export function libelleComposition(c) {
  if (!c) return '';
  if (c.type === 'mensuelle' && c.mois) return `Composition ${deDevant(NOM_MOIS[c.mois])}`;
  if (c.type === 'examen_blanc' && c.numero) return `Examen blanc n°${c.numero}`;
  return c.libelle;
}

/** Nom court pour les en-têtes de colonnes : « Octobre », « Examen blanc 1 »… */
export function nomCourtComposition(c) {
  if (c?.type === 'mensuelle' && c.mois) return NOM_MOIS[c.mois];
  if (c?.type === 'examen_blanc' && c.numero) return `Examen blanc ${c.numero}`;
  return c?.libelle || '';
}

function trier(liste) {
  const poids = (c) => (c.type === 'mensuelle' ? 0 : c.type === 'examen_blanc' ? 1 : 2);
  return [...liste].sort((a, b) => poids(a) - poids(b)
    || (a.type === 'mensuelle' ? rangMois(a.mois) - rangMois(b.mois) : 0)
    || (a.numero || 0) - (b.numero || 0)
    || (a.ordre || 0) - (b.ordre || 0));
}

export function useCompositions() {
  const { ieppId, annee } = useApp();
  const [liste, setListe] = useState([]);
  const charger = useCallback(async () => {
    if (!ieppId || !annee) { setListe([]); return; }
    const { data } = await supabase.from('compositions').select('*').eq('iepp_id', ieppId).eq('annee_id', annee.id);
    setListe(trier(data || []));
  }, [ieppId, annee]);
  useEffect(() => { charger(); }, [charger]);
  return [liste, charger];
}

/** Liste déroulante des compositions, groupées : mensuelles / examens blancs / autres. */
export function ChoixComposition({ compos, valeur, changer, label = 'Composition', seulement }) {
  const groupes = [
    ['mensuelle', 'Compositions mensuelles'],
    ['examen_blanc', 'Examens blancs'],
    ['autre', 'Autres évaluations'],
  ].filter(([t]) => !seulement || seulement.includes(t));
  return (
    <label>{label}
      <select value={valeur || ''} onChange={(e) => changer(e.target.value)}>
        {compos.length === 0 && <option value="">— aucune composition programmée —</option>}
        {groupes.map(([t, titre]) => {
          const items = compos.filter((c) => c.type === t);
          if (!items.length) return null;
          return (
            <optgroup key={t} label={titre}>
              {items.map((c) => <option key={c.id} value={c.id}>{libelleComposition(c)}{c.saisie_ouverte ? '' : ' (saisie fermée)'}</option>)}
            </optgroup>
          );
        })}
      </select>
    </label>
  );
}

export default function Compositions() {
  const { ieppId, annee, peutGerer, role } = useApp();
  const [liste, charger] = useCompositions();
  const [edition, setEdition] = useState(null);
  const [generer, setGenerer] = useState(false);
  const [msg, setMsg] = useState('');
  const nav = useNavigate();

  const mensuelles = liste.filter((c) => c.type === 'mensuelle');
  const examens = liste.filter((c) => c.type === 'examen_blanc');
  const autres = liste.filter((c) => c.type === 'autre');
  const moisPris = new Set(mensuelles.map((c) => c.mois));
  const numerosPris = new Set(examens.map((c) => c.numero));

  const t = edition?.type;
  const champs = [
    { nom: 'type', label: 'Type', type: 'select', requis: true, options: [
      { value: 'mensuelle', label: 'Composition mensuelle' },
      { value: 'examen_blanc', label: `Examen blanc (${MAX_EXAMENS_BLANCS} au maximum)` },
      { value: 'autre', label: 'Autre évaluation' },
    ] },
    ...(t === 'mensuelle' ? [{ nom: 'mois', label: 'Mois', type: 'select', requis: true,
      options: MOIS.filter(([m]) => !moisPris.has(m) || m === edition.mois_initial).map(([m, n]) => ({ value: String(m), label: n })) }] : []),
    ...(t === 'examen_blanc' ? [{ nom: 'numero', label: "N° de l'examen blanc", type: 'select', requis: true,
      options: [1, 2, 3].filter((n) => !numerosPris.has(n) || n === edition.numero_initial).map((n) => ({ value: String(n), label: `Examen blanc n°${n}` })) }] : []),
    ...(t === 'autre' ? [{ nom: 'libelle', label: 'Libellé', requis: true, pleine: true }] : []),
    { nom: 'date_debut', label: 'Début', type: 'date' },
    { nom: 'date_fin', label: 'Fin', type: 'date' },
    { nom: 'saisie_ouverte', label: 'Saisie des notes ouverte', type: 'checkbox', pleine: true },
    ...NIVEAUX.map((n) => ({ nom: `n_${n}`, label: `Niveau ${n}`, type: 'checkbox' })),
  ];

  function ouvrir(c, type = 'mensuelle') {
    const base = c || {
      type, saisie_ouverte: true,
      niveaux: type === 'examen_blanc' ? ['CM2'] : PRIMAIRE,
      mois: type === 'mensuelle' ? MOIS.find(([m]) => !moisPris.has(m))?.[0] : null,
      numero: type === 'examen_blanc' ? [1, 2, 3].find((n) => !numerosPris.has(n)) : null,
    };
    const v = { ...base, mois: base.mois ? String(base.mois) : null, numero: base.numero ? String(base.numero) : null,
      mois_initial: c?.mois, numero_initial: c?.numero };
    NIVEAUX.forEach((n) => { v[`n_${n}`] = (base.niveaux || []).includes(n); });
    setEdition(v);
  }

  function changementFormulaire(v) {
    // Quand on change de type, on propose les niveaux habituels
    if (edition && v.type !== edition.type) {
      const niv = v.type === 'examen_blanc' ? ['CM2'] : PRIMAIRE;
      NIVEAUX.forEach((n) => { v[`n_${n}`] = niv.includes(n); });
      if (v.type === 'mensuelle' && !v.mois) v.mois = String(MOIS.find(([m]) => !moisPris.has(m))?.[0] || '');
      if (v.type === 'examen_blanc' && !v.numero) v.numero = String([1, 2, 3].find((n) => !numerosPris.has(n)) || '');
    }
    setEdition({ ...v });
  }

  async function enregistrer(v) {
    if (v.type === 'examen_blanc' && !v.id && examens.length >= MAX_EXAMENS_BLANCS) {
      throw new Error(`Maximum ${MAX_EXAMENS_BLANCS} examens blancs par année.`);
    }
    const row = {
      type: v.type,
      mois: v.type === 'mensuelle' ? Number(v.mois) : null,
      numero: v.type === 'examen_blanc' ? Number(v.numero) : null,
      date_debut: v.date_debut || null, date_fin: v.date_fin || null,
      saisie_ouverte: !!v.saisie_ouverte, niveaux: NIVEAUX.filter((n) => v[`n_${n}`]),
    };
    if (v.type === 'mensuelle' && !row.mois) throw new Error('Choisissez le mois.');
    if (v.type === 'examen_blanc' && !row.numero) throw new Error("Choisissez le numéro de l'examen blanc.");
    row.libelle = v.type === 'autre' ? (v.libelle || '').trim() : libelleComposition(row);
    row.ordre = v.type === 'mensuelle' ? rangMois(row.mois) + 1 : v.type === 'examen_blanc' ? 20 + row.numero : 30;
    if (!row.libelle) throw new Error('Saisissez un libellé.');
    if (!row.niveaux.length) throw new Error('Cochez au moins un niveau.');
    const res = v.id
      ? await supabase.from('compositions').update(row).eq('id', v.id)
      : await supabase.from('compositions').insert({ id: uid(), iepp_id: ieppId, annee_id: annee.id, ...row });
    if (res.error) {
      const m = traduireErreur(res.error);
      throw new Error(/doublon/.test(m) ? 'Cette composition existe déjà (même mois ou même numéro).' : m);
    }
    setEdition(null);
    charger();
  }

  async function genererMois(moisChoisis) {
    const nouveaux = moisChoisis.filter((m) => !moisPris.has(m)).map((m) => {
      const r = { type: 'mensuelle', mois: m };
      return { id: uid(), iepp_id: ieppId, annee_id: annee.id, ...r, libelle: libelleComposition(r),
        ordre: rangMois(m) + 1, saisie_ouverte: true, niveaux: PRIMAIRE };
    });
    if (!nouveaux.length) throw new Error('Ces mois existent déjà.');
    const { error } = await supabase.from('compositions').insert(nouveaux);
    if (error) throw new Error(traduireErreur(error));
    setGenerer(false);
    setMsg(`${nouveaux.length} composition(s) mensuelle(s) créée(s).`);
    charger();
  }

  async function basculer(c) {
    const { error } = await supabase.from('compositions').update({ saisie_ouverte: !c.saisie_ouverte }).eq('id', c.id);
    if (error) alert(traduireErreur(error));
    charger();
  }

  async function supprimer(c) {
    if (!confirm(`Supprimer « ${libelleComposition(c)} » et TOUTES ses notes ?`)) return;
    const { error } = await supabase.from('compositions').delete().eq('id', c.id);
    if (error) alert(traduireErreur(error));
    charger();
  }

  if (!annee) return <div><h1>Compositions</h1><p className="vide">Aucune année scolaire active.</p></div>;

  const carte = (c) => (
    <div key={c.id} className="carte composition">
      <div className="titre-ligne">
        <h3>{libelleComposition(c)}</h3>
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
  );

  return (
    <div>
      <h1>Compositions</h1>
      <p className="sous-titre">Année scolaire {annee.libelle} — compositions mensuelles et examens blancs ({examens.length}/{MAX_EXAMENS_BLANCS}) de la circonscription. Chaque école saisit ses notes tant que la saisie est ouverte.</p>
      {peutGerer && (
        <div className="barre-outils">
          <button className="btn-contour" onClick={() => setGenerer(true)}>Générer les compositions mensuelles</button>
          <div className="espace" />
          <button className="btn" onClick={() => ouvrir(null, 'mensuelle')}>+ Composition mensuelle</button>
          <button className="btn" disabled={examens.length >= MAX_EXAMENS_BLANCS}
            title={examens.length >= MAX_EXAMENS_BLANCS ? `${MAX_EXAMENS_BLANCS} examens blancs déjà programmés` : ''}
            onClick={() => ouvrir(null, 'examen_blanc')}>+ Examen blanc</button>
        </div>
      )}
      {msg && <p className="succes">{msg}</p>}

      <h2>Compositions mensuelles ({mensuelles.length})</h2>
      <div className="grille-cartes">
        {mensuelles.length === 0 && <p className="vide">Aucune composition mensuelle. {peutGerer && 'Cliquez sur « Générer les compositions mensuelles » pour créer toute l’année en une fois.'}</p>}
        {mensuelles.map(carte)}
      </div>

      <h2>Examens blancs ({examens.length}/{MAX_EXAMENS_BLANCS})</h2>
      <div className="grille-cartes">
        {examens.length === 0 && <p className="vide">Aucun examen blanc programmé.</p>}
        {examens.map(carte)}
      </div>

      {autres.length > 0 && (
        <>
          <h2>Autres évaluations</h2>
          <div className="grille-cartes">{autres.map(carte)}</div>
        </>
      )}

      {edition && (
        <FormulaireModal key={edition.id || 'nouvelle'}
          titre={edition.id ? 'Modifier la composition' : edition.type === 'examen_blanc' ? 'Nouvel examen blanc' : 'Nouvelle composition'}
          champs={champs} initial={edition} fermer={() => setEdition(null)} enregistrer={enregistrer}
          surChangement={changementFormulaire} large />
      )}
      {generer && <GenererMois moisPris={moisPris} fermer={() => setGenerer(false)} valider={genererMois} />}
    </div>
  );
}

function GenererMois({ moisPris, fermer, valider }) {
  const [choix, setChoix] = useState(MOIS_PAR_DEFAUT.filter((m) => !moisPris.has(m)));
  const [erreur, setErreur] = useState('');
  const basculer = (m) => setChoix((c) => (c.includes(m) ? c.filter((x) => x !== m) : [...c, m]));
  return (
    <div className="voile" onMouseDown={(e) => e.target === e.currentTarget && fermer()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-tete"><h3>Générer les compositions mensuelles</h3><button className="fermer" onClick={fermer}>×</button></div>
        <div className="modal-corps formulaire">
          <p>Cochez les mois où la circonscription organise une composition (niveaux CP1 à CM2). Les mois déjà créés sont grisés.</p>
          <div className="grille-mois">
            {MOIS.map(([m, n]) => (
              <label key={m} className={`case ${moisPris.has(m) ? 'discret' : ''}`}>
                <input type="checkbox" disabled={moisPris.has(m)} checked={moisPris.has(m) || choix.includes(m)} onChange={() => basculer(m)} /> {n}
              </label>
            ))}
          </div>
          {erreur && <p className="erreur">{erreur}</p>}
          <div className="actions">
            <button className="btn-contour" onClick={fermer}>Annuler</button>
            <button className="btn" disabled={!choix.length} onClick={async () => { setErreur(''); try { await valider(choix); } catch (e) { setErreur(e.message); } }}>
              Créer {choix.length} composition(s)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
