import { useNavigate } from 'react-router-dom';
import { useApp } from './contexte.jsx';
import Crud from './Crud.jsx';
import { OPTIONS, libelle } from './Formulaire.jsx';
import { useListe } from './Choix.jsx';

export function champsEcole(secteurs) {
  return [
    { nom: 'nom', label: "Nom de l'école", requis: true, pleine: true },
    { nom: 'code_ecole', label: 'Code école' },
    { nom: 'secteur_id', label: 'Secteur pédagogique', type: 'select', options: secteurs.map((s) => ({ value: s.id, label: s.nom })) },
    { nom: 'statut', label: 'Statut', type: 'select', requis: true, options: OPTIONS.statut_ecole },
    { nom: 'cycle', label: 'Cycle', type: 'select', requis: true, options: OPTIONS.cycle_ecole },
    { nom: 'milieu', label: 'Milieu', type: 'select', options: OPTIONS.milieu },
    { nom: 'localite', label: 'Localité' },
    { nom: 'sous_prefecture', label: 'Sous-préfecture' },
    { nom: 'telephone', label: 'Téléphone', type: 'tel' },
    { nom: 'annee_creation', label: 'Année de création', type: 'number' },
    { nom: 'latitude', label: 'Latitude (GPS)', type: 'number' },
    { nom: 'longitude', label: 'Longitude (GPS)', type: 'number' },
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
  const { ieppId, peutGerer, profil } = useApp();
  const nav = useNavigate();
  const secteurs = useListe('secteurs', { filtre: { iepp_id: ieppId }, ordre: 'nom' });
  const filtre = { iepp_id: ieppId };
  if (profil.role === 'conseiller') filtre.secteur_id = profil.secteur_id;
  if (profil.role === 'directeur' || profil.role === 'saisie') filtre.id = profil.ecole_id;

  return (
    <Crud titre="Écoles" table="ecoles" filtre={filtre} lectureSeule={!peutGerer}
      select="*, secteurs(nom)"
      defauts={{ statut: 'public', cycle: 'primaire', actif: true }}
      champs={champsEcole(secteurs)}
      rechercheSur={['nom', 'code_ecole', 'localite']}
      colonnes={[
        { cle: 'nom', label: 'École', rendu: (l) => <b>{l.nom}</b> },
        { cle: 'code_ecole', label: 'Code' },
        { cle: 'secteur', label: 'Secteur', rendu: (l) => l.secteurs?.nom },
        { cle: 'statut', label: 'Statut', rendu: (l) => libelle('statut_ecole', l.statut) },
        { cle: 'cycle', label: 'Cycle', rendu: (l) => libelle('cycle_ecole', l.cycle) },
        { cle: 'localite', label: 'Localité' },
        { cle: 'actif', label: '', rendu: (l) => (!l.actif ? <span className="badge gris">Fermée</span> : null) },
      ]}
      actionsLigne={(l) => <button className="lien" onClick={() => nav(`/ecoles/${l.id}`)}>Ouvrir</button>}
    />
  );
}
