import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur, uid } from './supabase';
import { FormulaireModal } from './Crud.jsx';
import { OPTIONS, libelle } from './Formulaire.jsx';
import { dateFr, nomComplet, useEcoles, useListe } from './Choix.jsx';

const CHAMPS_PERSO = ['matricule', 'nom', 'prenoms', 'sexe', 'date_naissance', 'lieu_naissance', 'telephone', 'email', 'emploi_code', 'diplome_prof', 'diplome_acad', 'date_entree_fp', 'position'];
const CHAMPS_AFF = ['ecole_id', 'fonction_code', 'date_prise_service', 'observations'];

export default function Personnel() {
  const { ieppId, annee, peutGerer } = useApp();
  const ecoles = useEcoles();
  const emplois = useListe('emplois', { ordre: 'ordre' });
  const fonctions = useListe('fonctions', { ordre: 'libelle' });
  const [lignes, setLignes] = useState([]);
  const [edition, setEdition] = useState(null);
  const [recherche, setRecherche] = useState('');
  const [filtreEcole, setFiltreEcole] = useState('');
  const [msg, setMsg] = useState('');

  const charger = useCallback(async () => {
    if (!ieppId || !annee) return;
    const { data, error } = await supabase.from('affectations')
      .select('*, personnel(*), ecoles(nom)').eq('iepp_id', ieppId).eq('annee_id', annee.id);
    if (error) setMsg(traduireErreur(error));
    setLignes((data || []).sort((a, b) => nomComplet(a.personnel).localeCompare(nomComplet(b.personnel))));
  }, [ieppId, annee]);
  useEffect(() => { charger(); }, [charger]);

  const champs = [
    { nom: 'matricule', label: 'Matricule' },
    { nom: 'nom', label: 'Nom', requis: true },
    { nom: 'prenoms', label: 'Prénoms', requis: true },
    { nom: 'sexe', label: 'Sexe', type: 'select', options: OPTIONS.sexe },
    { nom: 'date_naissance', label: 'Date de naissance', type: 'date' },
    { nom: 'lieu_naissance', label: 'Lieu de naissance' },
    { nom: 'telephone', label: 'Téléphone', type: 'tel' },
    { nom: 'email', label: 'Email', type: 'email' },
    { nom: 'emploi_code', label: 'Emploi / grade', type: 'select', options: emplois.map((e) => ({ value: e.code, label: e.libelle })) },
    { nom: 'diplome_prof', label: 'Diplôme professionnel (CAP, CEAP…)' },
    { nom: 'diplome_acad', label: 'Diplôme académique (BEPC, BAC…)' },
    { nom: 'date_entree_fp', label: 'Entrée dans la fonction publique', type: 'date' },
    { nom: 'position', label: 'Position', type: 'select', requis: true, options: OPTIONS.position },
    { nom: 'ecole_id', label: 'Affecté à (vide = bureau IEPP)', type: 'select', options: ecoles.map((e) => ({ value: e.id, label: e.nom })) },
    { nom: 'fonction_code', label: 'Fonction', type: 'select', options: fonctions.map((f) => ({ value: f.code, label: f.libelle })) },
    { nom: 'date_prise_service', label: 'Prise de service', type: 'date' },
    { nom: 'observations', label: 'Observations', type: 'textarea' },
  ];

  async function enregistrer(v) {
    const perso = Object.fromEntries(CHAMPS_PERSO.map((k) => [k, v[k] ?? null]));
    const aff = Object.fromEntries(CHAMPS_AFF.map((k) => [k, v[k] ?? null]));
    if (!perso.position) perso.position = 'en_activite';
    if (v.personnel_id) {
      const r1 = await supabase.from('personnel').update(perso).eq('id', v.personnel_id);
      if (r1.error) throw new Error(traduireErreur(r1.error));
      const r2 = await supabase.from('affectations').update(aff).eq('id', v.affectation_id);
      if (r2.error) throw new Error(traduireErreur(r2.error));
    } else {
      const pid = uid();
      const r1 = await supabase.from('personnel').insert({ id: pid, ...perso });
      if (r1.error) {
        if (/doublon/.test(traduireErreur(r1.error))) throw new Error('Ce matricule existe déjà (agent enregistré dans une autre circonscription). Demandez au superviseur de faire la mutation.');
        throw new Error(traduireErreur(r1.error));
      }
      const r2 = await supabase.from('affectations').insert({ id: uid(), personnel_id: pid, annee_id: annee.id, iepp_id: ieppId, ...aff });
      if (r2.error) throw new Error(traduireErreur(r2.error));
    }
    setEdition(null);
    charger();
  }

  async function retirer(l) {
    if (!confirm(`Retirer ${nomComplet(l.personnel)} de la circonscription pour ${annee.libelle} ? (sa fiche reste conservée)`)) return;
    const { error } = await supabase.from('affectations').delete().eq('id', l.id);
    if (error) alert(traduireErreur(error));
    charger();
  }

  async function reconduire() {
    const { data: annees } = await supabase.from('annees_scolaires').select('id, libelle, date_debut').lt('date_debut', annee.date_debut).order('date_debut', { ascending: false }).limit(1);
    const prec = annees?.[0];
    if (!prec) return setMsg("Aucune année précédente trouvée.");
    if (!confirm(`Reconduire les affectations de ${prec.libelle} vers ${annee.libelle} (agents en activité non encore affectés) ?`)) return;
    const { data: anciennes } = await supabase.from('affectations').select('*, personnel(position)').eq('iepp_id', ieppId).eq('annee_id', prec.id);
    const deja = new Set(lignes.map((l) => l.personnel_id));
    const nouvelles = (anciennes || [])
      .filter((a) => !deja.has(a.personnel_id) && !['retraite', 'decede'].includes(a.personnel?.position))
      .map((a) => ({ id: uid(), personnel_id: a.personnel_id, annee_id: annee.id, iepp_id: ieppId, ecole_id: a.ecole_id, fonction_code: a.fonction_code, date_prise_service: a.date_prise_service }));
    if (!nouvelles.length) return setMsg('Rien à reconduire.');
    const { error } = await supabase.from('affectations').insert(nouvelles);
    setMsg(error ? traduireErreur(error) : `${nouvelles.length} affectation(s) reconduite(s).`);
    charger();
  }

  const filtrees = useMemo(() => {
    const t = recherche.trim().toLowerCase();
    return lignes.filter((l) => (!filtreEcole || (filtreEcole === 'bureau' ? !l.ecole_id : l.ecole_id === filtreEcole))
      && (!t || `${nomComplet(l.personnel)} ${l.personnel?.matricule || ''} ${l.personnel?.telephone || ''}`.toLowerCase().includes(t)));
  }, [lignes, recherche, filtreEcole]);

  if (!annee) return <div><h1>Personnel</h1><p className="vide">Aucune année scolaire active.</p></div>;

  const resume = emplois.map((e) => [e.code, lignes.filter((l) => l.personnel?.emploi_code === e.code).length]).filter(([, n]) => n);

  return (
    <div>
      <h1>Personnel</h1>
      <p className="sous-titre">{lignes.length} agent(s) affecté(s) en {annee.libelle} — {resume.map(([c, n]) => `${c} : ${n}`).join(' · ')}</p>
      <div className="barre-outils">
        <input className="recherche" placeholder="Nom, matricule, téléphone…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        <select value={filtreEcole} onChange={(e) => setFiltreEcole(e.target.value)}>
          <option value="">Toutes les affectations</option>
          <option value="bureau">Bureau IEPP</option>
          {ecoles.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
        </select>
        <div className="espace" />
        {peutGerer && <button className="btn-contour" onClick={reconduire}>Reconduire l'année précédente</button>}
        {peutGerer && <button className="btn" onClick={() => setEdition({ position: 'en_activite' })}>+ Ajouter un agent</button>}
        <button className="btn-contour" onClick={() => window.print()}>Imprimer</button>
      </div>
      {msg && <p className="succes">{msg}</p>}
      <div className="tableau-cadre">
        <table className="tableau">
          <thead><tr><th>Matricule</th><th>Nom et prénoms</th><th>Sexe</th><th>Emploi</th><th>Affectation</th><th>Fonction</th><th>Téléphone</th><th>Position</th><th className="non-imprime" /></tr></thead>
          <tbody>
            {filtrees.length === 0 && <tr><td colSpan={9} className="vide">Aucun agent.</td></tr>}
            {filtrees.map((l) => (
              <tr key={l.id}>
                <td>{l.personnel?.matricule}</td>
                <td><b>{nomComplet(l.personnel)}</b>{l.personnel?.date_naissance && <div className="discret">né(e) le {dateFr(l.personnel.date_naissance)}</div>}</td>
                <td>{l.personnel?.sexe}</td>
                <td>{l.personnel?.emploi_code}</td>
                <td>{l.ecoles?.nom || <span className="discret">Bureau IEPP</span>}</td>
                <td>{fonctions.find((f) => f.code === l.fonction_code)?.libelle}</td>
                <td>{l.personnel?.telephone}</td>
                <td>{libelle('position', l.personnel?.position)}</td>
                <td className="actions-ligne non-imprime">
                  {peutGerer && <button className="lien" onClick={() => setEdition({ ...l.personnel, ...l, personnel_id: l.personnel_id, affectation_id: l.id })}>Modifier</button>}
                  {peutGerer && <button className="lien danger" onClick={() => retirer(l)}>Retirer</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edition && <FormulaireModal titre={edition.personnel_id ? 'Modifier un agent' : 'Ajouter un agent'} champs={champs} initial={edition} fermer={() => setEdition(null)} enregistrer={enregistrer} large />}
    </div>
  );
}
