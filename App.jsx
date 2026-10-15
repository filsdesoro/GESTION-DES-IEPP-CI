import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './contexte.jsx';
import { configOk } from './supabase';
import Layout from './Layout.jsx';
import Connexion from './Connexion.jsx';
import TableauBord from './TableauBord.jsx';
import Parametrage from './Parametrage.jsx';
import Secteurs from './Secteurs.jsx';
import Ecoles from './Ecoles.jsx';
import EcoleDetail from './EcoleDetail.jsx';
import Annuaire from './Annuaire.jsx';
import Personnel from './Personnel.jsx';
import Eleves from './Eleves.jsx';
import Compositions from './Compositions.jsx';
import SaisieNotes from './SaisieNotes.jsx';
import BilanAnnuel from './BilanAnnuel.jsx';
import Releves from './Releves.jsx';
import Rendement from './Rendement.jsx';
import Statistiques from './Statistiques.jsx';
import SuiviSaisie from './SuiviSaisie.jsx';
import CartesScolaires from './CartesScolaires.jsx';
import FichesEPS from './FichesEPS.jsx';
import CEPE from './CEPE.jsx';
import Importer from './Importer.jsx';
import Comptes from './Comptes.jsx';
import Abonnements, { AbonnementBloque } from './Abonnements.jsx';

const TOUS = ['superviseur', 'iepp', 'conseiller', 'directeur', 'saisie'];
const GESTION = ['superviseur', 'iepp'];
const CIRC = ['superviseur', 'iepp', 'conseiller'];

export const MENU = [
  { chemin: '/', titre: 'Tableau de bord', roles: TOUS, el: <TableauBord /> },
  { chemin: '/parametrage', titre: 'Paramétrage circonscription', roles: GESTION, el: <Parametrage /> },
  { chemin: '/secteurs', titre: 'Secteurs pédagogiques', roles: CIRC, el: <Secteurs /> },
  { chemin: '/ecoles', titre: 'Écoles', roles: TOUS, el: <Ecoles /> },
  { chemin: '/annuaire', titre: 'Annuaire des écoles', roles: TOUS, el: <Annuaire /> },
  { chemin: '/personnel', titre: 'Personnel', roles: CIRC, el: <Personnel /> },
  { chemin: '/eleves', titre: 'Élèves', roles: TOUS, el: <Eleves /> },
  { chemin: '/compositions', titre: 'Compositions', roles: TOUS, el: <Compositions /> },
  { chemin: '/bilan', titre: 'Bilan annuel', roles: TOUS, el: <BilanAnnuel /> },
  { chemin: '/rendement', titre: 'Rendement des élèves', roles: TOUS, el: <Rendement /> },
  { chemin: '/releves', titre: 'Relevés de notes', roles: TOUS, el: <Releves /> },
  { chemin: '/statistiques', titre: 'Statistiques', roles: CIRC, el: <Statistiques /> },
  { chemin: '/suivi-saisie', titre: 'Suivi de la saisie', roles: CIRC, el: <SuiviSaisie /> },
  { chemin: '/cartes', titre: 'Cartes scolaires', roles: TOUS, el: <CartesScolaires /> },
  { chemin: '/eps', titre: 'Fiches EPS', roles: TOUS, el: <FichesEPS /> },
  { chemin: '/cepe', titre: 'Convocations CEPE', roles: TOUS, el: <CEPE /> },
  { chemin: '/importer', titre: 'Importer', roles: ['superviseur', 'iepp', 'directeur', 'saisie'], el: <Importer /> },
  { chemin: '/comptes', titre: 'Comptes utilisateurs', roles: GESTION, el: <Comptes /> },
  { chemin: '/abonnements', titre: 'Abonnements', roles: ['superviseur'], el: <Abonnements /> },
];

export default function App() {
  const { session, profil, role, chargement, erreurProfil, deconnexion, abonnementActif } = useApp();

  if (!configOk) {
    return (
      <div className="ecran-centre">
        <div className="carte" style={{ maxWidth: 520 }}>
          <h2>Configuration manquante</h2>
          <p>Renseignez <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_ANON_KEY</code> dans les variables d'environnement (fichier <code>.env</code> ou Vercel), puis relancez.</p>
        </div>
      </div>
    );
  }
  if (!session) return <Connexion />;
  if (chargement) return <div className="ecran-centre"><div className="chargeur" /></div>;
  if (!profil) {
    return (
      <div className="ecran-centre">
        <div className="carte" style={{ maxWidth: 480 }}>
          <h2>{/attente de validation/i.test(erreurProfil) ? 'Compte en attente' : /suspendu|désactivé/i.test(erreurProfil) ? 'Compte bloqué' : 'Accès impossible'}</h2>
          <p>{erreurProfil}</p>
          <p className="discret">Demandez à votre inspecteur ou au superviseur de vérifier votre compte.</p>
          <button className="btn" onClick={deconnexion}>Se déconnecter</button>
        </div>
      </div>
    );
  }

  if (role !== 'superviseur' && !abonnementActif) return <AbonnementBloque />;

  const autorises = MENU.filter((m) => m.roles.includes(role));
  return (
    <Layout menu={autorises}>
      <Routes>
        {autorises.map((m) => <Route key={m.chemin} path={m.chemin} element={m.el} />)}
        <Route path="/ecoles/:id" element={<EcoleDetail />} />
        <Route path="/compositions/:id/saisie" element={<SaisieNotes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
