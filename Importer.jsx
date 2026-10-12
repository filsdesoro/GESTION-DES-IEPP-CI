import { useState } from 'react';
import * as XLSX from 'xlsx';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur, uid } from './supabase';
import { ChoixEcoleClasse, useListe } from './Choix.jsx';

const MODELES = {
  eleves: {
    titre: 'Élèves (dans une classe)',
    colonnes: ['MATRICULE', 'NOM', 'PRENOMS', 'SEXE', 'DATE_NAISSANCE', 'LIEU_NAISSANCE', 'STATUT', 'NOM_PARENT', 'TELEPHONE_PARENT', 'EXTRAIT'],
    exemple: ['', 'KOUASSI', 'Ama Grâce', 'F', '12/03/2015', 'Agboville', 'nouveau', 'KOUASSI Yao', '0700000000', 'OUI'],
  },
  ecoles: {
    titre: 'Écoles de la circonscription',
    colonnes: ['NOM', 'CODE', 'STATUT', 'CYCLE', 'MILIEU', 'LOCALITE', 'SECTEUR', 'TELEPHONE', 'NB_SALLES'],
    exemple: ['EPP Plateau 1', '012345', 'public', 'primaire', 'urbain', 'Agboville', 'Secteur 1', '', '6'],
  },
  personnel: {
    titre: 'Personnel (affecté pour l’année active)',
    colonnes: ['MATRICULE', 'NOM', 'PRENOMS', 'SEXE', 'DATE_NAISSANCE', 'EMPLOI', 'TELEPHONE', 'CODE_ECOLE', 'FONCTION'],
    exemple: ['123456A', 'KONE', 'Seydou', 'M', '01/01/1985', 'IO', '0500000000', '012345', 'MAITRE'],
  },
};

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/[\s-]+/g, '_');

function dateIso(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
const sexe = (v) => { const s = norm(v); return s.startsWith('F') ? 'F' : s.startsWith('M') || s.startsWith('G') ? 'M' : null; };
const oui = (v) => ['OUI', 'O', 'X', '1', 'TRUE', 'VRAI'].includes(norm(v));

export default function Importer() {
  const { ieppId, annee, peutGerer } = useApp();
  const types = peutGerer ? ['eleves', 'ecoles', 'personnel'] : ['eleves'];
  const [type, setType] = useState('eleves');
  const [choix, setChoix] = useState({ ecoleId: null, classeId: null });
  const [lignes, setLignes] = useState([]);
  const [rapport, setRapport] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const secteurs = useListe('secteurs', { filtre: { iepp_id: ieppId } });
  const ecoles = useListe('ecoles', { select: 'id, code_ecole, nom', filtre: { iepp_id: ieppId } });

  function telechargerModele() {
    const m = MODELES[type];
    const ws = XLSX.utils.aoa_to_sheet([m.colonnes, m.exemple]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Données');
    XLSX.writeFile(wb, `modele_import_${type}.xlsx`);
  }

  async function lireFichier(e) {
    setRapport(null);
    const f = e.target.files?.[0];
    if (!f) return;
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const brut = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const propres = brut.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [norm(k), typeof v === 'string' ? v.trim() : v])))
      .filter((r) => r.NOM);
    setLignes(propres);
    e.target.value = '';
  }

  async function importer() {
    setEnvoi(true);
    const erreurs = [];
    let ok = 0;
    if (type === 'eleves') {
      for (const [k, r] of lignes.entries()) {
        const s = sexe(r.SEXE);
        if (!r.PRENOMS || !s) { erreurs.push(`Ligne ${k + 2} : prénoms ou sexe manquant`); continue; }
        const eid = uid();
        const r1 = await supabase.from('eleves').insert({
          id: eid, matricule: r.MATRICULE ? String(r.MATRICULE) : null, nom: String(r.NOM).toUpperCase(), prenoms: r.PRENOMS, sexe: s,
          date_naissance: dateIso(r.DATE_NAISSANCE), lieu_naissance: r.LIEU_NAISSANCE || null, nom_parent: r.NOM_PARENT || null,
          telephone_parent: r.TELEPHONE_PARENT ? String(r.TELEPHONE_PARENT) : null, extrait_naissance: oui(r.EXTRAIT),
        });
        if (r1.error) { erreurs.push(`Ligne ${k + 2} (${r.NOM} ${r.PRENOMS}) : ${traduireErreur(r1.error)}`); continue; }
        const statut = ['nouveau', 'redoublant', 'transfere_entrant'].includes(String(r.STATUT).toLowerCase()) ? String(r.STATUT).toLowerCase() : norm(r.STATUT).startsWith('R') ? 'redoublant' : 'nouveau';
        const r2 = await supabase.from('inscriptions').insert({ id: uid(), eleve_id: eid, classe_id: choix.classeId, annee_id: annee.id, statut });
        if (r2.error) erreurs.push(`Ligne ${k + 2} : ${traduireErreur(r2.error)}`); else ok++;
      }
    } else if (type === 'ecoles') {
      const statuts = ['public', 'prive_laic', 'prive_confessionnel', 'communautaire'];
      const rows = lignes.map((r) => ({
        id: uid(), iepp_id: ieppId, nom: r.NOM, code_ecole: r.CODE ? String(r.CODE) : null,
        statut: statuts.includes(String(r.STATUT).toLowerCase()) ? String(r.STATUT).toLowerCase() : norm(r.STATUT).includes('CONF') ? 'prive_confessionnel' : norm(r.STATUT).includes('PRIV') ? 'prive_laic' : norm(r.STATUT).includes('COMM') ? 'communautaire' : 'public',
        cycle: ['prescolaire', 'primaire', 'mixte'].includes(String(r.CYCLE).toLowerCase()) ? String(r.CYCLE).toLowerCase() : 'primaire',
        milieu: norm(r.MILIEU).startsWith('R') ? 'rural' : norm(r.MILIEU).startsWith('U') ? 'urbain' : null,
        localite: r.LOCALITE || null, telephone: r.TELEPHONE ? String(r.TELEPHONE) : null,
        nb_salles: r.NB_SALLES === '' ? 0 : Number(r.NB_SALLES) || 0,
        secteur_id: secteurs.find((s) => norm(s.nom) === norm(r.SECTEUR))?.id || null,
      }));
      for (const [k, row] of rows.entries()) {
        const { error } = await supabase.from('ecoles').insert(row);
        if (error) erreurs.push(`Ligne ${k + 2} (${row.nom}) : ${traduireErreur(error)}`); else ok++;
      }
    } else {
      for (const [k, r] of lignes.entries()) {
        if (!r.PRENOMS) { erreurs.push(`Ligne ${k + 2} : prénoms manquants`); continue; }
        const pid = uid();
        const r1 = await supabase.from('personnel').insert({
          id: pid, matricule: r.MATRICULE ? String(r.MATRICULE) : null, nom: String(r.NOM).toUpperCase(), prenoms: r.PRENOMS, sexe: sexe(r.SEXE),
          date_naissance: dateIso(r.DATE_NAISSANCE), emploi_code: r.EMPLOI ? norm(r.EMPLOI) : null, telephone: r.TELEPHONE ? String(r.TELEPHONE) : null,
        });
        if (r1.error) { erreurs.push(`Ligne ${k + 2} (${r.NOM} ${r.PRENOMS}) : ${traduireErreur(r1.error)}`); continue; }
        const ecole = ecoles.find((e) => r.CODE_ECOLE && String(e.code_ecole) === String(r.CODE_ECOLE));
        const r2 = await supabase.from('affectations').insert({ id: uid(), personnel_id: pid, annee_id: annee.id, iepp_id: ieppId, ecole_id: ecole?.id || null, fonction_code: r.FONCTION ? norm(r.FONCTION) : null });
        if (r2.error) erreurs.push(`Ligne ${k + 2} : ${traduireErreur(r2.error)}`); else ok++;
      }
    }
    setRapport({ ok, erreurs });
    if (!erreurs.length) setLignes([]);
    setEnvoi(false);
  }

  const m = MODELES[type];
  const pret = lignes.length > 0 && annee && (type !== 'eleves' || choix.classeId);

  return (
    <div>
      <h1>Importer</h1>
      <p className="sous-titre">Importez des listes depuis Excel (.xlsx) ou CSV. Téléchargez d'abord le modèle, remplissez-le, puis chargez-le.</p>
      <div className="onglets">
        {types.map((t) => <button key={t} className={type === t ? 'actif' : ''} onClick={() => { setType(t); setLignes([]); setRapport(null); }}>{MODELES[t].titre}</button>)}
      </div>
      <div className="carte">
        <p>Colonnes attendues : <code>{m.colonnes.join(' · ')}</code></p>
        {type === 'eleves' && <ChoixEcoleClasse valeur={choix} changer={setChoix} />}
        <div className="barre-outils">
          <button className="btn-contour" onClick={telechargerModele}>Télécharger le modèle</button>
          <label className="btn-contour fichier">Choisir le fichier…<input type="file" accept=".xlsx,.xls,.csv" onChange={lireFichier} hidden /></label>
          <div className="espace" />
          {lignes.length > 0 && <span className="discret">{lignes.length} ligne(s) lue(s)</span>}
          <button className="btn" disabled={!pret || envoi} onClick={importer}>{envoi ? 'Import en cours…' : 'Importer'}</button>
        </div>
        {type === 'eleves' && lignes.length > 0 && !choix.classeId && <p className="alerte">Choisissez la classe de destination.</p>}
      </div>
      {rapport && (
        <div className={`carte ${rapport.erreurs.length ? '' : 'carte-succes'}`}>
          <p className="succes">{rapport.ok} enregistrement(s) importé(s).</p>
          {rapport.erreurs.length > 0 && <><p className="erreur">{rapport.erreurs.length} ligne(s) en erreur :</p><ul className="liste-erreurs">{rapport.erreurs.map((e) => <li key={e}>{e}</li>)}</ul></>}
        </div>
      )}
      {lignes.length > 0 && (
        <div className="tableau-cadre">
          <table className="tableau">
            <thead><tr><th>#</th>{m.colonnes.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {lignes.slice(0, 200).map((r, k) => <tr key={k}><td>{k + 2}</td>{m.colonnes.map((c) => <td key={c}>{String(r[c] ?? '')}</td>)}</tr>)}
            </tbody>
          </table>
          {lignes.length > 200 && <p className="discret">… aperçu limité aux 200 premières lignes.</p>}
        </div>
      )}
    </div>
  );
}
