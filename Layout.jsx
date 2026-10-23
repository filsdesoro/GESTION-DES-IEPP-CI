import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ROLES, useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
import Modal from './Modal.jsx';
import { BandeauAbonnement } from './Abonnements.jsx';
import { BarreAnnuler } from './Corbeille.jsx';
import RechercheGenerale from './Recherche.jsx';
import { PastilleConnectes, usePresence } from './Connexions.jsx';
import { useNonLus } from './Messagerie.jsx';
import { useNouveautesForum } from './Forum.jsx';

export default function Layout({ menu, children }) {
  const { profil, role, iepps, iepp, ieppId, setIeppId, annee, deconnexion, actualiser, version } = useApp();
  const [tourne, setTourne] = useState(false);
  usePresence(!!profil?.id);
  const nouveautesForum = useNouveautesForum(!!profil?.id && menu.some((m) => m.chemin === '/forum'));
  const nonLus = useNonLus(!!profil?.id && menu.some((m) => m.chemin === '/messagerie'));
  async function toutActualiser() {
    setTourne(true);
    try { await actualiser(); } finally { setTimeout(() => setTourne(false), 600); }
  }
  const [ouvert, setOuvert] = useState(false);
  const [mdp, setMdp] = useState(false);
  const loc = useLocation();

  return (
    <div className="appli">
      <BandeauAbonnement />
      <header className="entete">
        <button className="burger" aria-label="Menu" onClick={() => setOuvert(!ouvert)}>☰{(nonLus > 0 || nouveautesForum > 0) && <span className="pastille-burger" />}</button>
        <div className="marque">
          <span className="marque-icone">🎓</span>
          <span>Gestion <b>IEPP</b></span>
        </div>
        <div className="sep" />
        {iepp?.logo_url && <img className="logo-iepp" src={iepp.logo_url} alt="" />}
        {role === 'superviseur' ? (
          <ChoixDrenaIepp iepps={iepps} iepp={iepp} ieppId={ieppId} setIeppId={setIeppId} />
        ) : (
          <div className="choix-iepp fixe">{iepp?.nom || '—'}</div>
        )}
        {annee && <span className="pastille-annee">{annee.libelle}</span>}
        <div className="espace" />
        <div className="utilisateur">
          <div className="avatar">{(profil.nom_complet || '?')[0].toUpperCase()}</div>
          <div className="utilisateur-texte">
            <b>{profil.nom_complet}</b>
            <span>{ROLES[role]}</span>
          </div>
        </div>
        {menu.some((m) => m.chemin === '/connexions') && <PastilleConnectes />}
        <RechercheGenerale menu={menu} />
        <button className={`btn-contour actualiser ${tourne ? 'tourne' : ''}`} onClick={toutActualiser} title="Recharger toutes les données affichées" disabled={tourne}>
          <span className="icone-actu" aria-hidden="true">⟳</span> Actualiser
        </button>
        <button className="btn-contour" onClick={() => setMdp(true)}>Mot de passe</button>
        <button className="btn-contour" onClick={deconnexion}>Déconnexion</button>
      </header>
      <div className="corps">
        <nav className={`menu ${ouvert ? 'ouvert' : ''}`} onClick={() => setOuvert(false)}>
          <button className="menu-recherche" onClick={() => window.dispatchEvent(new Event('gestion-iepp:recherche'))}>
            <span aria-hidden="true">🔍</span> Rechercher un élève, un agent, une école…
          </button>
          {menu.map((m) => (
            <NavLink key={m.chemin} to={m.chemin} end={m.chemin === '/'}
              className={({ isActive }) => (isActive || (m.chemin !== '/' && loc.pathname.startsWith(m.chemin)) ? 'actif' : '')}>
              {m.titre}
              {m.chemin === '/messagerie' && nonLus > 0 && <span className="compteur-menu">{nonLus}</span>}
              {m.chemin === '/forum' && nouveautesForum > 0 && <span className="compteur-menu vert" title="Sujets avec du nouveau">{nouveautesForum}</span>}
            </NavLink>
          ))}
        </nav>
        <main className="contenu">
          {!annee && (
            <div className="alerte">Aucune année scolaire active. {role === 'superviseur' ? 'Créez-la dans Paramétrage circonscription.' : 'Le superviseur doit en activer une.'}</div>
          )}
          <div key={`${version}-${loc.state ? loc.key : ''}`}>{children}</div>
        </main>
      </div>
      <BarreAnnuler />
      {mdp && <ChangerMotDePasse fermer={() => setMdp(false)} />}
    </div>
  );
}

/** Deux listes déroulantes liées : DRENA puis IEPP de cette DRENA. */
function ChoixDrenaIepp({ iepps, iepp, ieppId, setIeppId }) {
  const drenas = [...new Map(iepps.map((i) => [i.drena_id, i.drena?.nom || '—'])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'fr', { numeric: true }));
  const [drenaId, setDrenaId] = useState(iepp?.drena_id || '');
  const drenaCourante = drenaId || iepp?.drena_id || '';
  const liste = iepps.filter((i) => i.drena_id === drenaCourante)
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }));

  if (iepps.length === 0) return <select className="choix-iepp" disabled><option>Aucune circonscription</option></select>;
  return (
    <>
      <select className="choix-iepp choix-drena" title="DRENA" value={drenaCourante}
        onChange={(e) => {
          setDrenaId(e.target.value);
          const premiere = iepps.filter((i) => i.drena_id === e.target.value).sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }))[0];
          if (premiere) setIeppId(premiere.id);
        }}>
        {drenas.map(([id, nom]) => <option key={id} value={id}>{nom}</option>)}
      </select>
      <select className="choix-iepp" title="Circonscription (IEPP)" value={ieppId || ''} onChange={(e) => setIeppId(e.target.value)}>
        {liste.map((i) => <option key={i.id} value={i.id}>{i.nom}</option>)}
      </select>
    </>
  );
}

function ChangerMotDePasse({ fermer }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  async function valider(e) {
    e.preventDefault();
    if (a.length < 8) return setMsg('Au moins 8 caractères.');
    if (a !== b) return setMsg('Les deux mots de passe sont différents.');
    const { error } = await supabase.auth.updateUser({ password: a });
    if (error) return setMsg(traduireErreur(error));
    setOk(true);
    setMsg('Mot de passe modifié.');
  }
  return (
    <Modal titre="Changer mon mot de passe" fermer={fermer}>
      <form onSubmit={valider} className="formulaire">
        <label>Nouveau mot de passe<input type="password" value={a} onChange={(e) => setA(e.target.value)} autoFocus /></label>
        <label>Confirmer<input type="password" value={b} onChange={(e) => setB(e.target.value)} /></label>
        {msg && <p className={ok ? 'succes' : 'erreur'}>{msg}</p>}
        <div className="actions">
          <button type="button" className="btn-contour" onClick={fermer}>Fermer</button>
          {!ok && <button className="btn">Enregistrer</button>}
        </div>
      </form>
    </Modal>
  );
}
