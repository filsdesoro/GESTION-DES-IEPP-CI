import { useCallback, useEffect, useState } from 'react';
import { ROLES, useApp } from './contexte.jsx';
import { API_URL, api, supabase, traduireErreur } from './supabase';
import { FormulaireModal } from './Crud.jsx';
import Modal from './Modal.jsx';
import { useListe } from './Choix.jsx';

function motDePasseProvisoire() {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => c[x % c.length]).join('');
}

export default function Comptes() {
  const { role, ieppId, iepps, profil } = useApp();
  const [comptes, setComptes] = useState([]);
  const [emails, setEmails] = useState({});
  const [edition, setEdition] = useState(null);
  const [identifiants, setIdentifiants] = useState(null);
  const [msg, setMsg] = useState('');
  const secteurs = useListe('secteurs', { filtre: { iepp_id: edition?.iepp_id || ieppId }, ordre: 'nom' });
  const ecoles = useListe('ecoles', { select: 'id, nom', filtre: { iepp_id: edition?.iepp_id || ieppId }, ordre: 'nom' });
  const toutesEcoles = useListe('ecoles', { select: 'id, nom' });
  const tousSecteurs = useListe('secteurs', { select: 'id, nom' });

  const charger = useCallback(async () => {
    let q = supabase.from('profils').select('*').order('nom_complet');
    if (role === 'iepp') q = q.eq('iepp_id', ieppId);
    const { data, error } = await q;
    if (error) setMsg(traduireErreur(error));
    setComptes(data || []);
    if (API_URL) {
      try { const r = await api('/api/comptes'); setEmails(Object.fromEntries(r.comptes.map((c) => [c.id, c.email]))); } catch { /* serveur endormi : emails masqués */ }
    }
  }, [role, ieppId]);
  useEffect(() => { charger(); }, [charger]);

  const rolesPermis = role === 'superviseur' ? Object.keys(ROLES) : ['conseiller', 'directeur', 'saisie'];
  const r = edition?.role;
  const champs = [
    { nom: 'nom_complet', label: 'Nom complet', requis: true, pleine: true },
    ...(edition?.id ? [] : [{ nom: 'email', label: 'Email (identifiant de connexion)', type: 'email', requis: true }, { nom: 'mot_de_passe', label: 'Mot de passe provisoire', requis: true, aide: "À communiquer à l'utilisateur ; il pourra le changer." }]),
    { nom: 'role', label: 'Rôle', type: 'select', requis: true, options: rolesPermis.map((x) => ({ value: x, label: ROLES[x] })) },
    ...(role === 'superviseur' && r && r !== 'superviseur' ? [{ nom: 'iepp_id', label: 'Circonscription', type: 'select', requis: true, options: iepps.map((i) => ({ value: i.id, label: i.nom })) }] : []),
    ...(r === 'conseiller' ? [{ nom: 'secteur_id', label: 'Secteur pédagogique', type: 'select', requis: true, options: secteurs.map((s) => ({ value: s.id, label: s.nom })) }] : []),
    ...(r === 'directeur' || r === 'saisie' ? [{ nom: 'ecole_id', label: 'École', type: 'select', requis: true, options: ecoles.map((e) => ({ value: e.id, label: e.nom })) }] : []),
  ];

  function nettoyer(v) {
    const p = { nom_complet: v.nom_complet, role: v.role, iepp_id: null, secteur_id: null, ecole_id: null };
    if (v.role !== 'superviseur') p.iepp_id = role === 'superviseur' ? v.iepp_id : ieppId;
    if (v.role === 'conseiller') p.secteur_id = v.secteur_id;
    if (v.role === 'directeur' || v.role === 'saisie') p.ecole_id = v.ecole_id;
    return p;
  }

  async function enregistrer(v) {
    const p = nettoyer(v);
    if (v.id) {
      const { error } = await supabase.from('profils').update(p).eq('id', v.id);
      if (error) throw new Error(traduireErreur(error));
    } else {
      if (String(v.mot_de_passe).length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
      await api('/api/comptes', { method: 'POST', body: JSON.stringify({ ...p, email: v.email.trim().toLowerCase(), mot_de_passe: v.mot_de_passe }) });
      setIdentifiants({ nom: p.nom_complet, email: v.email.trim().toLowerCase(), mdp: v.mot_de_passe });
    }
    setEdition(null);
    charger();
  }

  async function basculer(c) {
    const { error } = await supabase.from('profils').update({ actif: !c.actif }).eq('id', c.id);
    if (error) setMsg(traduireErreur(error));
    charger();
  }

  async function reinitialiser(c) {
    const mdp = motDePasseProvisoire();
    if (!confirm(`Générer un nouveau mot de passe pour ${c.nom_complet} ?`)) return;
    try {
      await api(`/api/comptes/${c.id}/mot-de-passe`, { method: 'POST', body: JSON.stringify({ mot_de_passe: mdp }) });
      setIdentifiants({ nom: c.nom_complet, email: emails[c.id] || '', mdp });
    } catch (e) { setMsg(e.message); }
  }

  async function supprimer(c) {
    if (!confirm(`Supprimer définitivement le compte de ${c.nom_complet} ?`)) return;
    try { await api(`/api/comptes/${c.id}`, { method: 'DELETE' }); charger(); } catch (e) { setMsg(e.message); }
  }

  const nomIepp = (id) => iepps.find((i) => i.id === id)?.nom || '';
  const portee = (c) => c.role === 'superviseur' ? 'Toutes les circonscriptions'
    : c.role === 'iepp' ? nomIepp(c.iepp_id)
      : c.role === 'conseiller' ? `Secteur ${tousSecteurs.find((s) => s.id === c.secteur_id)?.nom || ''}`
        : toutesEcoles.find((e) => e.id === c.ecole_id)?.nom || '';

  return (
    <div>
      <h1>Comptes utilisateurs</h1>
      {!API_URL && <div className="alerte">Le serveur n'est pas configuré : la création de comptes et la réinitialisation des mots de passe sont indisponibles.</div>}
      <div className="barre-outils">
        <span className="discret">{comptes.length} compte(s)</span>
        <div className="espace" />
        <button className="btn" disabled={!API_URL} onClick={() => setEdition({ role: rolesPermis[rolesPermis.length - 2] || 'directeur', iepp_id: ieppId, mot_de_passe: motDePasseProvisoire() })}>+ Créer un compte</button>
      </div>
      {msg && <p className="erreur">{msg}</p>}
      <div className="tableau-cadre">
        <table className="tableau">
          <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Périmètre</th><th>État</th><th /></tr></thead>
          <tbody>
            {comptes.map((c) => (
              <tr key={c.id}>
                <td><b>{c.nom_complet}</b></td>
                <td>{emails[c.id] || <span className="discret">—</span>}</td>
                <td>{ROLES[c.role]}</td>
                <td>{portee(c)}</td>
                <td>{c.actif ? <span className="badge vert">Actif</span> : <span className="badge gris">Désactivé</span>}</td>
                <td className="actions-ligne">
                  {c.id !== profil.id && (role === 'superviseur' || c.role !== 'superviseur') && (
                    <>
                      <button className="lien" onClick={() => setEdition({ ...c })}>Modifier</button>
                      <button className="lien" onClick={() => reinitialiser(c)}>Nouveau mot de passe</button>
                      <button className="lien" onClick={() => basculer(c)}>{c.actif ? 'Désactiver' : 'Activer'}</button>
                      <button className="lien danger" onClick={() => supprimer(c)}>Supprimer</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edition && <FormulaireModal titre={edition.id ? 'Modifier le compte' : 'Créer un compte'} champs={champs} initial={edition} fermer={() => setEdition(null)} enregistrer={enregistrer} surChangement={setEdition} key={edition.id || 'nouveau'} />}
      {identifiants && (
        <Modal titre="Identifiants à communiquer" fermer={() => setIdentifiants(null)}>
          <div className="identifiants">
            <p><b>{identifiants.nom}</b></p>
            <p>Adresse : <code>{window.location.origin}</code></p>
            <p>Email : <code>{identifiants.email}</code></p>
            <p>Mot de passe provisoire : <code>{identifiants.mdp}</code></p>
          </div>
          <p className="discret">Notez-les maintenant : le mot de passe ne sera plus affiché. L'utilisateur pourra le changer via « Mot de passe ».</p>
          <div className="actions">
            <button className="btn-contour" onClick={() => navigator.clipboard?.writeText(`Gestion IEPP\n${window.location.origin}\nEmail : ${identifiants.email}\nMot de passe : ${identifiants.mdp}`)}>Copier</button>
            <button className="btn" onClick={() => setIdentifiants(null)}>Fermer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
