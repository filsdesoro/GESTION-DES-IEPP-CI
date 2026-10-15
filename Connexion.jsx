import { useEffect, useMemo, useState } from 'react';
import { supabase, traduireErreur } from './supabase';
import { ROLES } from './contexte.jsx';

/** Identifiant saisi → email de connexion (un numéro de téléphone devient un email interne). */
export const versEmail = (x) => {
  const t = String(x || '').trim();
  return t.includes('@') ? t.toLowerCase() : `${t.replace(/[^0-9]/g, '')}@tel.gestion-iepp.ci`;
};

export default function Connexion() {
  const [mode, setMode] = useState('connexion');
  return (
    <div className="page-connexion">
      <div className="connexion-gauche">
        <div className="marque grande"><span className="marque-icone">🎓</span><span>Gestion <b>IEPP</b></span></div>
        <h1>Le pilotage des circonscriptions du préscolaire et du primaire</h1>
        <p>Écoles, personnel, élèves, compositions, statistiques et CEPE : toute la circonscription au même endroit, chaque acteur dans son périmètre.</p>
        <p className="discret">République de Côte d'Ivoire — Ministère de l'Éducation Nationale et de l'Alphabétisation</p>
      </div>
      <div className="connexion-droite">
        <div className="bascule-connexion">
          <button type="button" className={mode === 'connexion' ? 'actif' : ''} onClick={() => setMode('connexion')}>Se connecter</button>
          <button type="button" className={mode === 'inscription' ? 'actif' : ''} onClick={() => setMode('inscription')}>Créer mon compte</button>
        </div>
        {mode === 'connexion' ? <FormConnexion versInscription={() => setMode('inscription')} /> : <FormInscription versConnexion={() => setMode('connexion')} />}
      </div>
    </div>
  );
}

function FormConnexion({ versInscription }) {
  const [email, setEmail] = useState('');
  const [mdp, setMdp] = useState('');
  const [voir, setVoir] = useState(false);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  async function connecter(e) {
    e.preventDefault();
    setEnvoi(true);
    setErreur('');
    const { error } = await supabase.auth.signInWithPassword({ email: versEmail(email), password: mdp });
    if (error) setErreur(traduireErreur(error));
    setEnvoi(false);
  }

  return (
    <form className="carte connexion-carte" onSubmit={connecter}>
      <h2>Connexion</h2>
      <label>Email ou numéro de téléphone<input value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username" placeholder="ex. 0707000000 ou nom@exemple.com" /></label>
      <label>Mot de passe
        <span className="champ-mdp">
          <input type={voir ? 'text' : 'password'} value={mdp} onChange={(e) => setMdp(e.target.value)} required />
          <button type="button" className="lien" onClick={() => setVoir(!voir)}>{voir ? 'Masquer' : 'Afficher'}</button>
        </span>
      </label>
      {erreur && <p className="erreur">{erreur}</p>}
      <button className="btn large" disabled={envoi}>{envoi ? 'Connexion…' : 'Se connecter'}</button>
      <p className="discret">Mot de passe oublié ? Contactez votre inspecteur ou le superviseur.</p>
      <div className="separateur"><span>ou</span></div>
      <button type="button" className="btn-contour large" onClick={versInscription}>Créer mon compte</button>
    </form>
  );
}

function FormInscription({ versConnexion }) {
  const [liste, setListe] = useState(null);
  const [structures, setStructures] = useState([]);
  const [v, setV] = useState({ role: 'directeur', drena: '', iepp: '', secteur: '', ecole: '', nom: '', telephone: '', email: '', mdp: '', mdp2: '' });
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [attente, setAttente] = useState(null);

  useEffect(() => {
    supabase.rpc('iepp_inscription').then(({ data, error }) => {
      if (error) setErreur("L'inscription en ligne n'est pas encore disponible. Contactez le gestionnaire.");
      setListe(data || []);
    });
  }, []);
  useEffect(() => {
    setStructures([]);
    if (!v.iepp) return;
    supabase.rpc('structures_inscription', { p_iepp: v.iepp }).then(({ data }) => setStructures(data || []));
  }, [v.iepp]);

  const drenas = useMemo(() => {
    const m = new Map();
    (liste || []).forEach((i) => { if (i.drena_id) m.set(i.drena_id, i.drena); });
    return [...m].map(([id, nom]) => ({ id, nom })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }, [liste]);
  const iepps = (liste || []).filter((i) => i.drena_id === v.drena);
  const secteurs = structures.filter((x) => x.type === 'secteur');
  const ecoles = structures.filter((x) => x.type === 'ecole');
  const maj = (k) => (e) => setV({
    ...v, [k]: e.target.value,
    ...(k === 'drena' ? { iepp: '', secteur: '', ecole: '' } : {}),
    ...(k === 'iepp' ? { secteur: '', ecole: '' } : {}),
  });

  async function inscrire(e) {
    e.preventDefault();
    setErreur('');
    if (!v.iepp) return setErreur('Choisissez votre DRENA puis votre circonscription (IEPP).');
    if (v.role === 'conseiller' && !v.secteur) return setErreur('Choisissez votre secteur pédagogique.');
    if (['directeur', 'saisie'].includes(v.role) && !v.ecole) return setErreur('Choisissez votre école.');
    if (v.telephone.replace(/[^0-9]/g, '').length < 8) return setErreur('Indiquez un numéro de téléphone valide.');
    if (v.mdp.length < 8) return setErreur('Le mot de passe doit contenir au moins 8 caractères.');
    if (v.mdp !== v.mdp2) return setErreur('Les deux mots de passe ne sont pas identiques.');
    setEnvoi(true);
    const identifiant = v.email.trim() ? v.email.trim().toLowerCase() : v.telephone;
    const { data, error } = await supabase.rpc('inscription_utilisateur', {
      p_identifiant: identifiant, p_mot_de_passe: v.mdp, p_nom_complet: v.nom.trim(), p_role: v.role,
      p_iepp: v.iepp, p_secteur: v.secteur || null, p_ecole: v.ecole || null, p_telephone: v.telephone.trim(),
    });
    if (error) { setEnvoi(false); return setErreur(traduireErreur(error)); }
    if (data === 'en_attente') { setEnvoi(false); return setAttente(v.email.trim() ? v.email.trim().toLowerCase() : v.telephone.trim()); }
    const r = await supabase.auth.signInWithPassword({ email: versEmail(identifiant), password: v.mdp });
    setEnvoi(false);
    if (r.error) setErreur(`Compte créé. Connectez-vous maintenant avec votre identifiant et votre mot de passe. (${traduireErreur(r.error)})`);
  }

  if (attente) {
    return (
      <div className="carte connexion-carte">
        <h2>Compte créé</h2>
        <div className="etat-declaration orange">
          <strong>En attente de validation</strong>
          <span>Votre inspecteur doit valider votre compte. Dès qu'il l'aura fait, connectez-vous avec :</span>
        </div>
        <p>Identifiant : <b>{attente}</b><br />Mot de passe : celui que vous venez de choisir.</p>
        <button type="button" className="btn large" onClick={versConnexion}>Aller à la connexion</button>
      </div>
    );
  }

  return (
    <form className="carte connexion-carte" onSubmit={inscrire}>
      <h2>Créer mon compte</h2>
      <label>Je suis
        <select value={v.role} onChange={maj('role')}>
          {['directeur', 'saisie', 'conseiller', 'iepp'].map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
        </select>
      </label>
      <p className="discret">
        {v.role === 'iepp'
          ? "L'inspecteur crée le compte de la circonscription, règle l'abonnement annuel puis saisit son code d'activation."
          : 'Votre compte sera actif dès que votre inspecteur l’aura validé.'}
      </p>
      <label>DRENA
        <select value={v.drena} onChange={maj('drena')} required disabled={!liste}>
          <option value="">{liste ? '— choisir votre DRENA —' : 'Chargement…'}</option>
          {drenas.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
        </select>
      </label>
      <label>Circonscription (IEPP)
        <select value={v.iepp} onChange={maj('iepp')} required disabled={!v.drena}>
          <option value="">— choisir votre IEPP —</option>
          {iepps.map((i) => <option key={i.id} value={i.id} disabled={v.role === 'iepp' && i.a_un_inspecteur}>{i.nom}{v.role === 'iepp' && i.a_un_inspecteur ? ' (déjà inscrite)' : ''}</option>)}
        </select>
      </label>
      {v.role === 'conseiller' && (
        <label>Secteur pédagogique
          <select value={v.secteur} onChange={maj('secteur')} required disabled={!v.iepp}>
            <option value="">{v.iepp && !secteurs.length ? '— aucun secteur enregistré —' : '— choisir votre secteur —'}</option>
            {secteurs.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
          </select>
        </label>
      )}
      {['directeur', 'saisie'].includes(v.role) && (
        <label>École
          <select value={v.ecole} onChange={maj('ecole')} required disabled={!v.iepp}>
            <option value="">{v.iepp && !ecoles.length ? '— aucune école enregistrée —' : '— choisir votre école —'}</option>
            {ecoles.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
          </select>
        </label>
      )}
      <label>Nom et prénoms<input value={v.nom} onChange={maj('nom')} required /></label>
      <label>Téléphone<input type="tel" value={v.telephone} onChange={maj('telephone')} required placeholder="07 00 00 00 00" /></label>
      <label>Email <span className="discret">(facultatif : sans email, vous vous connecterez avec votre téléphone)</span>
        <input type="email" value={v.email} onChange={maj('email')} />
      </label>
      <div className="deux-champs">
        <label>Mot de passe<input type="password" value={v.mdp} onChange={maj('mdp')} required minLength={8} placeholder="8 caractères minimum" /></label>
        <label>Confirmer<input type="password" value={v.mdp2} onChange={maj('mdp2')} required minLength={8} /></label>
      </div>
      {erreur && <p className="erreur">{erreur}</p>}
      <button className="btn large" disabled={envoi || !liste}>{envoi ? 'Création du compte…' : 'Créer mon compte'}</button>
      <button type="button" className="lien" onClick={versConnexion}>J'ai déjà un compte : se connecter</button>
    </form>
  );
}
