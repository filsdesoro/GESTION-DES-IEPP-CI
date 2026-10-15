import { useEffect, useMemo, useState } from 'react';
import { supabase, traduireErreur } from './supabase';

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
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: mdp });
    if (error) setErreur(traduireErreur(error));
    setEnvoi(false);
  }

  return (
    <form className="carte connexion-carte" onSubmit={connecter}>
      <h2>Connexion</h2>
      <label>Adresse email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
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
      <button type="button" className="btn-contour large" onClick={versInscription}>Créer mon compte (inspecteur IEPP)</button>
    </form>
  );
}

function FormInscription({ versConnexion }) {
  const [liste, setListe] = useState(null);
  const [v, setV] = useState({ drena: '', iepp: '', nom: '', telephone: '', email: '', mdp: '', mdp2: '' });
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    supabase.rpc('iepp_inscription').then(({ data, error }) => {
      if (error) setErreur("L'inscription en ligne n'est pas encore disponible. Contactez le gestionnaire.");
      setListe(data || []);
    });
  }, []);

  const drenas = useMemo(() => {
    const m = new Map();
    (liste || []).forEach((i) => { if (i.drena_id) m.set(i.drena_id, i.drena); });
    return [...m].map(([id, nom]) => ({ id, nom })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }, [liste]);
  const iepps = (liste || []).filter((i) => i.drena_id === v.drena);
  const maj = (k) => (e) => setV({ ...v, [k]: e.target.value, ...(k === 'drena' ? { iepp: '' } : {}) });

  async function inscrire(e) {
    e.preventDefault();
    setErreur('');
    if (!v.iepp) return setErreur('Choisissez votre DRENA puis votre circonscription (IEPP).');
    if (v.mdp.length < 8) return setErreur('Le mot de passe doit contenir au moins 8 caractères.');
    if (v.mdp !== v.mdp2) return setErreur('Les deux mots de passe ne sont pas identiques.');
    setEnvoi(true);
    const email = v.email.trim().toLowerCase();
    const { error } = await supabase.rpc('inscription_inspecteur', {
      p_email: email, p_mot_de_passe: v.mdp, p_nom_complet: v.nom.trim(), p_iepp: v.iepp, p_telephone: v.telephone.trim() || null,
    });
    if (error) { setEnvoi(false); return setErreur(traduireErreur(error)); }
    const r = await supabase.auth.signInWithPassword({ email, password: v.mdp });
    setEnvoi(false);
    if (r.error) setErreur(`Compte créé. Connectez-vous maintenant avec votre email et votre mot de passe. (${traduireErreur(r.error)})`);
  }

  return (
    <form className="carte connexion-carte" onSubmit={inscrire}>
      <h2>Créer mon compte</h2>
      <p className="discret">Réservé à l'<b>inspecteur</b> (chef de circonscription). Après l'inscription, vous réglez l'abonnement annuel puis vous saisissez votre code d'activation. Les comptes des conseillers, directeurs et agents de saisie sont ensuite créés par l'inspecteur.</p>
      <label>DRENA
        <select value={v.drena} onChange={maj('drena')} required disabled={!liste}>
          <option value="">{liste ? '— choisir votre DRENA —' : 'Chargement…'}</option>
          {drenas.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
        </select>
      </label>
      <label>Circonscription (IEPP)
        <select value={v.iepp} onChange={maj('iepp')} required disabled={!v.drena}>
          <option value="">— choisir votre IEPP —</option>
          {iepps.map((i) => <option key={i.id} value={i.id} disabled={i.a_un_inspecteur}>{i.nom}{i.a_un_inspecteur ? ' (déjà inscrite)' : ''}</option>)}
        </select>
      </label>
      <label>Nom et prénoms<input value={v.nom} onChange={maj('nom')} required /></label>
      <label>Téléphone<input type="tel" value={v.telephone} onChange={maj('telephone')} placeholder="07 00 00 00 00" /></label>
      <label>Adresse email<input type="email" value={v.email} onChange={maj('email')} required /></label>
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
