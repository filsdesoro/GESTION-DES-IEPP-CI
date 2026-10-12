import { useState } from 'react';
import { supabase, traduireErreur } from './supabase';

export default function Connexion() {
  const [email, setEmail] = useState('');
  const [mdp, setMdp] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  async function connecter(e) {
    e.preventDefault();
    setEnvoi(true);
    setErreur('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: mdp });
    if (error) setErreur(traduireErreur(error));
    setEnvoi(false);
  }

  return (
    <div className="page-connexion">
      <div className="connexion-gauche">
        <div className="marque grande"><span className="marque-icone">🎓</span><span>Gestion <b>IEPP</b></span></div>
        <h1>Le pilotage des circonscriptions du préscolaire et du primaire</h1>
        <p>Écoles, personnel, élèves, compositions, statistiques et CEPE : toute la circonscription au même endroit, chaque acteur dans son périmètre.</p>
        <p className="discret">République de Côte d'Ivoire — Ministère de l'Éducation Nationale et de l'Alphabétisation</p>
      </div>
      <form className="carte connexion-carte" onSubmit={connecter}>
        <h2>Connexion</h2>
        <label>Adresse email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
        <label>Mot de passe<input type="password" value={mdp} onChange={(e) => setMdp(e.target.value)} required /></label>
        {erreur && <p className="erreur">{erreur}</p>}
        <button className="btn large" disabled={envoi}>{envoi ? 'Connexion…' : 'Se connecter'}</button>
        <p className="discret">Mot de passe oublié ? Contactez votre inspecteur ou le superviseur.</p>
      </form>
    </div>
  );
}
