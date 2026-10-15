import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROLES, useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
import Modal from './Modal.jsx';
import { dateFr } from './Choix.jsx';

export const MODES = [
  ['orange_money', 'Orange Money'],
  ['mtn_momo', 'MTN MoMo'],
  ['moov_money', 'Moov Money'],
  ['wave', 'Wave'],
  ['especes', 'Espèces'],
  ['virement', 'Virement bancaire'],
  ['gratuit', 'Gratuit (offert)'],
];
const libelleMode = (m) => MODES.find((x) => x[0] === m)?.[1] || m || '';
const fcfa = (n, devise = 'FCFA') => `${Number(n || 0).toLocaleString('fr-FR')} ${devise}`;
const ETATS = { valide: ['Payé', 'vert'], en_attente: ['En attente de validation', 'orange'], refuse: ['Refusé', 'rouge'] };

function useConfig() {
  const [config, setConfig] = useState(null);
  const charger = useCallback(() => {
    supabase.from('config_abonnement').select('*').eq('id', 1).maybeSingle().then(({ data }) => setConfig(data || { montant: 0, devise: 'FCFA', instructions: '', contact: '' }));
  }, []);
  useEffect(() => { charger(); }, [charger]);
  return [config, charger];
}

// =====================================================================
//  Écran affiché aux utilisateurs d'une IEPP sans abonnement validé
// =====================================================================
export function AbonnementBloque() {
  const { profil, role, iepp, annee, deconnexion, recharger } = useApp();
  const [config] = useConfig();
  const [declaration, setDeclaration] = useState(undefined);
  const [v, setV] = useState({ mode: 'orange_money', reference: '', telephone: '', date_paiement: new Date().toISOString().slice(0, 10) });
  const [envoi, setEnvoi] = useState(false);
  const [msg, setMsg] = useState('');

  const charger = useCallback(async () => {
    if (!profil?.iepp_id || !annee) return;
    const { data } = await supabase.from('abonnements').select('*').eq('iepp_id', profil.iepp_id).eq('annee_id', annee.id).maybeSingle();
    setDeclaration(data || null);
    if (data) setV({ mode: data.mode, reference: data.reference || '', telephone: data.telephone || '', date_paiement: data.date_paiement || '' });
  }, [profil, annee]);
  useEffect(() => { charger(); }, [charger]);

  async function declarer(e) {
    e.preventDefault();
    setMsg('');
    if (!v.reference.trim() && v.mode !== 'especes') return setMsg('Indiquez la référence (ID) de la transaction reçue par SMS.');
    setEnvoi(true);
    const ligne = {
      iepp_id: profil.iepp_id, annee_id: annee.id, montant: config?.montant || 0, mode: v.mode,
      reference: v.reference.trim() || null, telephone: v.telephone.trim() || null, date_paiement: v.date_paiement || null, statut: 'en_attente',
    };
    const res = declaration
      ? await supabase.from('abonnements').update(ligne).eq('id', declaration.id)
      : await supabase.from('abonnements').insert(ligne);
    setEnvoi(false);
    if (res.error) return setMsg(traduireErreur(res.error));
    setMsg('ok');
    charger();
  }

  const etat = declaration ? ETATS[declaration.statut] : null;
  return (
    <div className="ecran-centre fond-abonnement">
      <div className="carte abonnement-bloque">
        <div className="marque"><span className="marque-icone">🎓</span><span>Gestion <b>IEPP</b></span></div>
        <h1>Abonnement {annee?.libelle}</h1>
        <p className="sous-titre">
          <strong>{iepp?.nom || 'Votre circonscription'}</strong> n'a pas encore d'abonnement validé pour l'année scolaire {annee?.libelle}.
          L'accès au logiciel est suspendu jusqu'à la validation du paiement.
        </p>

        {config && (
          <div className="tarif">
            <span>Abonnement annuel</span>
            <strong>{fcfa(config.montant, config.devise)}</strong>
            <small>par circonscription, pour toute l'année scolaire</small>
          </div>
        )}

        {role !== 'iepp' ? (
          <div className="alerte">
            Seul l'inspecteur (compte IEPP) peut régler l'abonnement. Merci de le contacter.
            {config?.contact && <> Gestionnaire : <strong>{config.contact}</strong>.</>}
          </div>
        ) : (
          <>
            {config?.instructions && <p className="instructions">{config.instructions}</p>}
            {config?.contact && <p>Contact / numéro de paiement : <strong>{config.contact}</strong></p>}

            {etat && (
              <div className={`etat-declaration ${etat[1]}`}>
                <strong>{etat[0]}</strong>
                {declaration.statut === 'en_attente' && <span>Votre paiement ({libelleMode(declaration.mode)}{declaration.reference ? `, réf. ${declaration.reference}` : ''}) a bien été déclaré. L'accès sera rétabli dès sa validation.</span>}
                {declaration.statut === 'refuse' && <span>{declaration.observations || 'Le paiement n’a pas pu être vérifié.'} Corrigez la déclaration ci-dessous.</span>}
              </div>
            )}

            {declaration?.statut !== 'valide' && (
              <form className="formulaire" onSubmit={declarer}>
                <h3>{declaration ? 'Modifier ma déclaration' : 'Déclarer mon paiement'}</h3>
                <div className="grille-champs">
                  <label><span>Moyen de paiement</span>
                    <select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>
                      {MODES.filter(([k]) => k !== 'gratuit').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <label><span>Référence / ID de la transaction</span>
                    <input value={v.reference} placeholder="ex. MP261015.1234.A56789" onChange={(e) => setV({ ...v, reference: e.target.value })} />
                  </label>
                  <label><span>Numéro qui a payé</span>
                    <input type="tel" value={v.telephone} placeholder="07 00 00 00 00" onChange={(e) => setV({ ...v, telephone: e.target.value })} />
                  </label>
                  <label><span>Date du paiement</span>
                    <input type="date" value={v.date_paiement} onChange={(e) => setV({ ...v, date_paiement: e.target.value })} />
                  </label>
                </div>
                {msg && msg !== 'ok' && <p className="erreur">{msg}</p>}
                {msg === 'ok' && <p className="succes">Déclaration envoyée. Le gestionnaire va vérifier votre paiement.</p>}
                <div className="actions"><button className="btn" disabled={envoi}>{envoi ? 'Envoi…' : 'Envoyer la déclaration'}</button></div>
              </form>
            )}
          </>
        )}

        <div className="pied-abonnement">
          <span className="discret">{profil?.nom_complet} — {ROLES[role]}</span>
          <span>
            <button className="btn-contour" onClick={recharger}>J'ai été validé : actualiser</button>{' '}
            <button className="btn-contour" onClick={deconnexion}>Déconnexion</button>
          </span>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
//  Page du superviseur : tarif + suivi et validation des abonnements
// =====================================================================
export default function Abonnements() {
  const { iepps, annee } = useApp();
  const [config, chargerConfig] = useConfig();
  const [abos, setAbos] = useState([]);
  const [filtre, setFiltre] = useState('en_attente');
  const [recherche, setRecherche] = useState('');
  const [edition, setEdition] = useState(null);
  const [tarif, setTarif] = useState(null);
  const [msg, setMsg] = useState('');

  const charger = useCallback(async () => {
    if (!annee) return;
    const { data, error } = await supabase.from('abonnements').select('*').eq('annee_id', annee.id);
    if (error) setMsg(traduireErreur(error));
    setAbos(data || []);
  }, [annee]);
  useEffect(() => { charger(); }, [charger]);

  const lignes = useMemo(() => iepps.map((i) => ({ iepp: i, abo: abos.find((a) => a.iepp_id === i.id) || null })), [iepps, abos]);
  const compte = (f) => lignes.filter((l) => (f === 'non_paye' ? !l.abo : l.abo?.statut === f)).length;
  const encaisse = abos.filter((a) => a.statut === 'valide').reduce((t, a) => t + Number(a.montant || 0), 0);
  const t = recherche.trim().toLowerCase();
  const affichees = lignes
    .filter((l) => filtre === 'tous' || (filtre === 'non_paye' ? !l.abo : l.abo?.statut === filtre))
    .filter((l) => !t || `${l.iepp.nom} ${l.iepp.drena?.nom || ''}`.toLowerCase().includes(t));

  async function changerStatut(abo, statut, observations) {
    setMsg('');
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('abonnements').update({
      statut, observations: observations ?? abo.observations, valide_par: statut === 'valide' ? u.user?.id : null, valide_le: statut === 'valide' ? new Date().toISOString() : null,
    }).eq('id', abo.id);
    if (error) setMsg(traduireErreur(error)); else charger();
  }

  async function enregistrerEdition(e) {
    e.preventDefault();
    const { data: u } = await supabase.auth.getUser();
    const ligne = {
      iepp_id: edition.iepp.id, annee_id: annee.id, montant: Number(edition.montant) || 0, mode: edition.mode,
      reference: edition.reference || null, telephone: edition.telephone || null, date_paiement: edition.date_paiement || null,
      observations: edition.observations || null, statut: 'valide', valide_par: u.user?.id, valide_le: new Date().toISOString(),
    };
    const res = edition.id ? await supabase.from('abonnements').update(ligne).eq('id', edition.id) : await supabase.from('abonnements').insert(ligne);
    if (res.error) return setEdition({ ...edition, erreur: traduireErreur(res.error) });
    setEdition(null);
    charger();
  }

  async function enregistrerTarif(e) {
    e.preventDefault();
    const { error } = await supabase.from('config_abonnement').upsert({ id: 1, montant: Number(tarif.montant) || 0, devise: tarif.devise || 'FCFA', instructions: tarif.instructions || '', contact: tarif.contact || null, updated_at: new Date().toISOString() });
    if (error) return setTarif({ ...tarif, erreur: traduireErreur(error) });
    setTarif(null);
    chargerConfig();
  }

  if (!annee) return <p className="vide carte">Aucune année scolaire active. Activez-en une dans Paramétrage.</p>;

  return (
    <div>
      <div className="titre-ligne">
        <h1>Abonnements {annee.libelle}</h1>
        <button className="btn-contour" disabled={!config} onClick={() => setTarif({ ...config })}>Tarif et instructions</button>
      </div>
      {config && <p className="sous-titre">Tarif : <strong>{fcfa(config.montant, config.devise)}</strong> par circonscription et par année scolaire{config.contact ? ` — contact : ${config.contact}` : ''}.</p>}

      <div className="grille-stats">
        <div className="carte stat orange"><span>À valider</span><strong>{compte('en_attente')}</strong></div>
        <div className="carte stat vert"><span>Payés</span><strong>{compte('valide')}</strong></div>
        <div className="carte stat rouge"><span>Non payés</span><strong>{compte('non_paye')}</strong></div>
        <div className="carte stat"><span>Montant encaissé</span><strong>{fcfa(encaisse, config?.devise)}</strong></div>
      </div>

      <div className="barre-outils">
        <div className="bascule">
          {[['en_attente', 'À valider'], ['valide', 'Payés'], ['non_paye', 'Non payés'], ['refuse', 'Refusés'], ['tous', 'Toutes']].map(([k, l]) => (
            <button key={k} className={filtre === k ? 'actif' : ''} onClick={() => setFiltre(k)}>{l}{k !== 'tous' ? ` (${compte(k)})` : ''}</button>
          ))}
        </div>
        <input className="recherche" placeholder="Rechercher une IEPP ou une DRENA…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
      </div>
      {msg && <p className="erreur">{msg}</p>}

      <div className="tableau-cadre">
        <table className="tableau">
          <thead><tr><th>Circonscription</th><th>DRENA</th><th>État</th><th>Paiement</th><th className="nombre">Montant</th><th /></tr></thead>
          <tbody>
            {affichees.length === 0 && <tr><td colSpan={6} className="vide">Aucune circonscription dans cette liste.</td></tr>}
            {affichees.map(({ iepp, abo }) => {
              const etat = abo ? ETATS[abo.statut] : ['Non payé', 'gris'];
              return (
                <tr key={iepp.id}>
                  <td><strong>{iepp.nom}</strong></td>
                  <td>{iepp.drena?.nom || '—'}</td>
                  <td><span className={`badge ${etat[1]}`}>{etat[0]}</span>{abo?.statut === 'refuse' && abo.observations && <div className="discret">{abo.observations}</div>}</td>
                  <td>{abo ? <>{libelleMode(abo.mode)}{abo.reference && <div className="discret">Réf. {abo.reference}</div>}{abo.telephone && <div className="discret">Tél. {abo.telephone}</div>}{abo.date_paiement && <div className="discret">le {dateFr(abo.date_paiement)}</div>}</> : '—'}</td>
                  <td className="nombre">{abo ? fcfa(abo.montant, config?.devise) : '—'}</td>
                  <td className="actions-ligne">
                    {abo?.statut === 'en_attente' && <button className="btn petit" onClick={() => changerStatut(abo, 'valide')}>Valider</button>}
                    {abo?.statut === 'en_attente' && <button className="lien" onClick={() => setEdition({ refus: true, abo, observations: '' })}>Refuser</button>}
                    {abo?.statut === 'valide' && <button className="lien" onClick={() => changerStatut(abo, 'en_attente')}>Suspendre</button>}
                    {!abo && <button className="btn-contour petit" onClick={() => setEdition({ iepp, montant: config?.montant || 0, mode: 'especes', reference: '', telephone: '', date_paiement: new Date().toISOString().slice(0, 10), observations: '' })}>Enregistrer un paiement</button>}
                    {abo && abo.statut !== 'en_attente' && <button className="lien" onClick={() => setEdition({ iepp, ...abo })}>Modifier</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {edition?.refus && (
        <Modal titre="Refuser le paiement" fermer={() => setEdition(null)}>
          <form className="formulaire" onSubmit={(e) => { e.preventDefault(); changerStatut(edition.abo, 'refuse', edition.observations || 'Paiement introuvable.'); setEdition(null); }}>
            <label><span>Motif (visible par l'inspecteur)</span>
              <textarea rows={3} value={edition.observations} placeholder="ex. Référence introuvable, montant incomplet…" onChange={(e) => setEdition({ ...edition, observations: e.target.value })} />
            </label>
            <div className="actions"><button type="button" className="btn-contour" onClick={() => setEdition(null)}>Annuler</button><button className="btn">Refuser</button></div>
          </form>
        </Modal>
      )}

      {edition && !edition.refus && (
        <Modal titre={`Paiement — ${edition.iepp.nom}`} fermer={() => setEdition(null)}>
          <form className="formulaire" onSubmit={enregistrerEdition}>
            <div className="grille-champs">
              <label><span>Moyen de paiement</span>
                <select value={edition.mode} onChange={(e) => setEdition({ ...edition, mode: e.target.value, montant: e.target.value === 'gratuit' ? 0 : edition.montant })}>
                  {MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label><span>Montant ({config?.devise || 'FCFA'})</span>
                <input type="number" min="0" value={edition.montant} onChange={(e) => setEdition({ ...edition, montant: e.target.value })} />
              </label>
              <label><span>Référence</span><input value={edition.reference || ''} onChange={(e) => setEdition({ ...edition, reference: e.target.value })} /></label>
              <label><span>Date du paiement</span><input type="date" value={edition.date_paiement || ''} onChange={(e) => setEdition({ ...edition, date_paiement: e.target.value })} /></label>
              <label className="pleine"><span>Observations</span><textarea rows={2} value={edition.observations || ''} onChange={(e) => setEdition({ ...edition, observations: e.target.value })} /></label>
            </div>
            <p className="discret">En enregistrant, l'abonnement {annee.libelle} de cette circonscription est validé et son accès est ouvert.</p>
            {edition.erreur && <p className="erreur">{edition.erreur}</p>}
            <div className="actions"><button type="button" className="btn-contour" onClick={() => setEdition(null)}>Annuler</button><button className="btn">Valider l'abonnement</button></div>
          </form>
        </Modal>
      )}

      {tarif && (
        <Modal titre="Tarif et instructions de paiement" fermer={() => setTarif(null)}>
          <form className="formulaire" onSubmit={enregistrerTarif}>
            <div className="grille-champs">
              <label><span>Montant annuel par IEPP</span><input type="number" min="0" value={tarif.montant} onChange={(e) => setTarif({ ...tarif, montant: e.target.value })} /></label>
              <label><span>Devise</span><input value={tarif.devise} onChange={(e) => setTarif({ ...tarif, devise: e.target.value })} /></label>
              <label className="pleine"><span>Numéro(s) de paiement / contact</span>
                <input value={tarif.contact || ''} placeholder="ex. Orange Money 07 00 00 00 00 — Wave 05 00 00 00 00 (M. …)" onChange={(e) => setTarif({ ...tarif, contact: e.target.value })} />
              </label>
              <label className="pleine"><span>Instructions affichées aux inspecteurs</span>
                <textarea rows={4} value={tarif.instructions} onChange={(e) => setTarif({ ...tarif, instructions: e.target.value })} />
              </label>
            </div>
            {tarif.erreur && <p className="erreur">{tarif.erreur}</p>}
            <div className="actions"><button type="button" className="btn-contour" onClick={() => setTarif(null)}>Annuler</button><button className="btn">Enregistrer</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
