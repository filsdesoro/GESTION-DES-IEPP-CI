import { useNavigate } from 'react-router-dom';
import { useApp } from './contexte.jsx';
import Crud from './Crud.jsx';
import { OPTIONS, libelle } from './Formulaire.jsx';
import { nomComplet, useEquipes, useListe } from './Choix.jsx';

/**
 * Champs de la fiche école. Avec `rattachement`, ajoute DRENA puis IEPP (listes liées) :
 * rattachement = { drenas, iepps, ieppParDefaut, modifiable }
 */
export function champsEcole(secteurs, rattachement, v = {}) {
  const tri = (a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true });
  let haut = [];
  let secteursFiltres = secteurs;
  if (rattachement) {
    const { drenas, iepps, ieppParDefaut, modifiable } = rattachement;
    const ieppId = v.iepp_id || ieppParDefaut?.id;
    const drenaId = v.drena_id || iepps.find((i) => i.id === ieppId)?.drena_id || ieppParDefaut?.drena_id;
    haut = [
      { nom: 'drena_id', label: 'DRENA', type: 'select', requis: true, desactive: !modifiable, defaut: drenaId,
        options: drenas.map((d) => ({ value: d.id, label: d.nom })).sort(tri) },
      { nom: 'iepp_id', label: 'IEPP (circonscription)', type: 'select', requis: true, desactive: !modifiable, defaut: ieppId,
        options: iepps.filter((i) => i.drena_id === drenaId).map((i) => ({ value: i.id, label: i.nom })).sort(tri) },
    ];
    secteursFiltres = secteurs.filter((s) => s.iepp_id === ieppId);
  }
  return [
    ...haut,
    { nom: 'nom', label: "Nom de l'école", requis: true, pleine: true },
    { nom: 'code_ecole', label: 'Code école' },
    { nom: 'secteur_id', label: 'Secteur pédagogique', type: 'select', options: secteursFiltres.map((s) => ({ value: s.id, label: s.nom })) },
    { nom: 'statut', label: 'Statut', type: 'select', requis: true, options: OPTIONS.statut_ecole },
    { nom: 'cycle', label: 'Cycle', type: 'select', requis: true, options: OPTIONS.cycle_ecole },
    { nom: 'milieu', label: 'Milieu', type: 'select', options: OPTIONS.milieu },
    { nom: 'localite', label: 'Localité' },
    { nom: 'sous_prefecture', label: 'Sous-préfecture' },
    { nom: 'telephone', label: 'Téléphone', type: 'tel' },
    { nom: 'annee_creation', label: 'Année de création', type: 'number' },
    { nom: 'nb_salles', label: 'Nombre de salles', type: 'number' },
    { nom: 'nb_salles_bon_etat', label: 'Salles en bon état', type: 'number' },
    { nom: 'nb_tables_bancs', label: 'Tables-bancs', type: 'number' },
    { nom: 'a_cantine', label: 'Cantine', type: 'checkbox' },
    { nom: 'a_latrines', label: 'Latrines', type: 'checkbox' },
    { nom: 'a_point_eau', label: "Point d'eau", type: 'checkbox' },
    { nom: 'a_electricite', label: 'Électricité', type: 'checkbox' },
    { nom: 'a_cloture', label: 'Clôture', type: 'checkbox' },
    { nom: 'actif', label: 'École ouverte', type: 'checkbox' },
  ];
}

export default function Ecoles() {
  const { ieppId, iepp, iepps, peutGerer, profil, role } = useApp();
  const nav = useNavigate();
  const secteurs = useListe('secteurs', { select: 'id, nom, iepp_id', ordre: 'nom' });
  const equipes = useEquipes();
  const drenas = useListe('drena', { ordre: 'nom' });
  const rattachement = { drenas, iepps, ieppParDefaut: iepp, modifiable: role === 'superviseur' };

  // DRENA/IEPP : on vérifie la cohérence puis on retire drena_id (pas une colonne de la table)
  async function avantSauvegarde(row) {
    const ieppChoisie = row.iepp_id || ieppId;
    const drenaChoisie = row.drena_id || iepps.find((i) => i.id === ieppChoisie)?.drena_id;
    const ok = iepps.find((i) => i.id === ieppChoisie && i.drena_id === drenaChoisie);
    if (!ok) throw new Error("Choisissez l'IEPP correspondant à la DRENA sélectionnée.");
    const r = { ...row, iepp_id: ieppChoisie };
    delete r.drena_id;
    if (r.secteur_id && !secteurs.find((s) => s.id === r.secteur_id && s.iepp_id === ieppChoisie)) r.secteur_id = null;
    return r;
  }
  const filtre = { iepp_id: ieppId };
  if (profil.role === 'conseiller') filtre.secteur_id = profil.secteur_id;
  if (['directeur', 'saisie', 'enseignant'].includes(profil.role)) filtre.id = profil.ecole_id;

  return (
    <Crud titre="Écoles" table="ecoles" filtre={filtre} lectureSeule={!peutGerer}
      select="*, secteurs(nom)"
      defauts={{ statut: 'public', cycle: 'primaire', actif: true }}
      champs={(v) => champsEcole(secteurs, rattachement, v)}
      avantSauvegarde={avantSauvegarde}
      ajuster={(v, avant) => {
        // Nouvelle DRENA choisie : on propose sa première IEPP et on vide le secteur
        if (v.drena_id && v.drena_id !== avant.drena_id) {
          const premiere = iepps.filter((i) => i.drena_id === v.drena_id).sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }))[0];
          return { ...v, iepp_id: premiere?.id || null, secteur_id: null };
        }
        if (v.iepp_id !== avant.iepp_id) return { ...v, secteur_id: null };
        return v;
      }}
      titreFormulaire="école"
      rechercheSur={['nom', 'code_ecole', 'localite']}
      colonnes={[
        { cle: 'nom', label: 'École', rendu: (l) => <b>{l.nom}</b> },
        { cle: 'code_ecole', label: 'Code' },
        { cle: 'secteur', label: 'Secteur', rendu: (l) => l.secteurs?.nom },
        { cle: 'directeur', label: 'Directeur', rendu: (l) => nomComplet(equipes.directeurs[l.id]) || <span className="discret">—</span> },
        { cle: 'statut', label: 'Statut', rendu: (l) => libelle('statut_ecole', l.statut) },
        { cle: 'cycle', label: 'Cycle', rendu: (l) => libelle('cycle_ecole', l.cycle) },
        { cle: 'localite', label: 'Localité' },
        { cle: 'actif', label: '', rendu: (l) => (!l.actif ? <span className="badge gris">Fermée</span> : null) },
      ]}
      actionsLigne={(l) => <button className="lien" onClick={() => nav(`/ecoles/${l.id}`)}>Ouvrir</button>}
    />
  );
}
