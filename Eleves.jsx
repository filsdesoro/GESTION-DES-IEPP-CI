import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur, uid } from './supabase';
import { FormulaireModal } from './Crud.jsx';
import { OPTIONS, libelle } from './Formulaire.jsx';
import { ChoixEcoleClasse, dateFr, nomComplet, useListe } from './Choix.jsx';

export const CHAMPS_ELEVE = [
  { nom: 'matricule', label: 'Matricule' },
  { nom: 'nom', label: 'Nom', requis: true },
  { nom: 'prenoms', label: 'Prénoms', requis: true },
  { nom: 'sexe', label: 'Sexe', type: 'select', requis: true, options: OPTIONS.sexe },
  { nom: 'date_naissance', label: 'Date de naissance', type: 'date' },
  { nom: 'lieu_naissance', label: 'Lieu de naissance' },
  { nom: 'extrait_naissance', label: "Possède un extrait d'acte de naissance", type: 'checkbox' },
  { nom: 'num_extrait', label: "N° de l'extrait" },
  { nom: 'nationalite', label: 'Nationalité' },
  { nom: 'nom_parent', label: 'Parent / tuteur' },
  { nom: 'telephone_parent', label: 'Téléphone du parent', type: 'tel' },
  { nom: 'statut', label: "Statut d'inscription", type: 'select', requis: true, options: OPTIONS.statut_eleve },
];
const COLS_ELEVE = CHAMPS_ELEVE.map((c) => c.nom).filter((k) => k !== 'statut');

/** Élèves inscrits dans une classe (avec la fiche élève). */
export function useInscrits(classeId) {
  const [liste, setListe] = useState([]);
  const charger = useCallback(async () => {
    if (!classeId) { setListe([]); return; }
    const { data } = await supabase.from('inscriptions').select('*, eleves(*)').eq('classe_id', classeId);
    setListe((data || []).filter((i) => i.eleves).sort((a, b) => nomComplet(a.eleves).localeCompare(nomComplet(b.eleves))));
  }, [classeId]);
  useEffect(() => { charger(); }, [charger]);
  return [liste, charger];
}

export default function Eleves() {
  const { annee, role } = useApp();
  const [choix, setChoix] = useState({ ecoleId: null, classeId: null });
  const [inscrits, recharger] = useInscrits(choix.classeId);
  const classes = useListe('classes', { select: 'id, nom', filtre: { ecole_id: choix.ecoleId, annee_id: annee?.id || null }, ordre: 'nom' });
  const [edition, setEdition] = useState(null);
  const [transfert, setTransfert] = useState(null);
  const [recherche, setRecherche] = useState('');
  const modifiable = role !== 'conseiller';

  async function enregistrer(v) {
    const eleve = Object.fromEntries(COLS_ELEVE.map((k) => [k, v[k] ?? null]));
    if (v.inscription_id) {
      const r1 = await supabase.from('eleves').update(eleve).eq('id', v.eleve_id);
      if (r1.error) throw new Error(traduireErreur(r1.error));
      const r2 = await supabase.from('inscriptions').update({ statut: v.statut }).eq('id', v.inscription_id);
      if (r2.error) throw new Error(traduireErreur(r2.error));
    } else {
      const eid = uid();
      const r1 = await supabase.from('eleves').insert({ id: eid, ...eleve });
      if (r1.error) throw new Error(traduireErreur(r1.error));
      const r2 = await supabase.from('inscriptions').insert({ id: uid(), eleve_id: eid, classe_id: choix.classeId, annee_id: annee.id, statut: v.statut || 'nouveau' });
      if (r2.error) throw new Error(traduireErreur(r2.error));
    }
    setEdition(null);
    recharger();
  }

  async function retirer(i) {
    if (!confirm(`Supprimer ${nomComplet(i.eleves)} ?\nSon inscription et ses notes de l'année seront effacées définitivement.`)) return;
    let { error } = await supabase.rpc('supprimer_eleve', { p_inscription: i.id });
    if (error && /function|schema cache/i.test(error.message)) ({ error } = await supabase.from('inscriptions').delete().eq('id', i.id)); // script 015 non lancé
    if (error) alert(traduireErreur(error));
    recharger();
  }

  async function changerClasse(nouvelle) {
    const { error } = await supabase.from('inscriptions').update({ classe_id: nouvelle }).eq('id', transfert.id);
    if (error) alert(traduireErreur(error));
    setTransfert(null);
    recharger();
  }

  const filtres = useMemo(() => {
    const t = recherche.trim().toLowerCase();
    return t ? inscrits.filter((i) => `${nomComplet(i.eleves)} ${i.eleves.matricule || ''}`.toLowerCase().includes(t)) : inscrits;
  }, [inscrits, recherche]);
  const filles = inscrits.filter((i) => i.eleves.sexe === 'F').length;

  return (
    <div>
      <h1>Élèves</h1>
      <ChoixEcoleClasse valeur={choix} changer={setChoix} />
      {!choix.classeId ? <p className="vide">Choisissez une école puis une classe. Les classes se créent dans Écoles → Ouvrir.</p> : (
        <>
          <div className="barre-outils">
            <input className="recherche" placeholder="Rechercher un élève…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
            <span className="discret">{inscrits.length} élève(s) — {filles} fille(s), {inscrits.length - filles} garçon(s)</span>
            <div className="espace" />
            <button className="btn-contour" onClick={() => window.print()}>Imprimer la liste</button>
            {modifiable && <button className="btn" onClick={() => setEdition({ statut: 'nouveau', nationalite: 'Ivoirienne' })}>+ Inscrire un élève</button>}
          </div>
          <div className="tableau-cadre">
            <table className="tableau">
              <thead><tr><th>N°</th><th>Matricule</th><th>Nom et prénoms</th><th>Sexe</th><th>Né(e) le</th><th>À</th><th>Statut</th><th>Extrait</th><th className="non-imprime" /></tr></thead>
              <tbody>
                {filtres.length === 0 && <tr><td colSpan={9} className="vide">Aucun élève inscrit.</td></tr>}
                {filtres.map((i, n) => (
                  <tr key={i.id}>
                    <td>{n + 1}</td>
                    <td>{i.eleves.matricule}</td>
                    <td><b>{nomComplet(i.eleves)}</b></td>
                    <td>{i.eleves.sexe}</td>
                    <td>{dateFr(i.eleves.date_naissance)}</td>
                    <td>{i.eleves.lieu_naissance}</td>
                    <td>{libelle('statut_eleve', i.statut)}</td>
                    <td>{i.eleves.extrait_naissance ? '✓' : <span className="badge orange">Non</span>}</td>
                    <td className="actions-ligne non-imprime">
                      {modifiable && <button className="lien" onClick={() => setEdition({ ...i.eleves, statut: i.statut, eleve_id: i.eleve_id, inscription_id: i.id })}>Modifier</button>}
                      {modifiable && <button className="lien" onClick={() => setTransfert(i)}>Changer de classe</button>}
                      {modifiable && <button className="lien danger" onClick={() => retirer(i)}>Supprimer</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {edition && <FormulaireModal titre={edition.inscription_id ? 'Modifier un élève' : 'Inscrire un élève'} champs={CHAMPS_ELEVE} initial={edition} fermer={() => setEdition(null)} enregistrer={enregistrer} large />}
      {transfert && (
        <FormulaireModal titre={`Changer ${nomComplet(transfert.eleves)} de classe`}
          champs={[{ nom: 'classe', label: 'Nouvelle classe', type: 'select', requis: true, options: classes.filter((c) => c.id !== choix.classeId).map((c) => ({ value: c.id, label: c.nom })) }]}
          initial={{}} fermer={() => setTransfert(null)} enregistrer={(v) => changerClasse(v.classe)} />
      )}
    </div>
  );
}
