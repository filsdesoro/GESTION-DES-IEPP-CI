import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROLES, useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
import Modal from './Modal.jsx';
import { dateFr } from './Choix.jsx';
import { signalerSuppression } from './Corbeille.jsx';

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
const ETATS = { valide: ['Actif', 'vert'], paye: ['Payé — code à saisir', 'bleu'], en_attente: ['En attente de validation', 'orange'], refuse: ['Refusé', 'rouge'] };
const groupe = (statut) => (statut === 'paye' ? 'valide' : statut);

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
  const [v, setV] = useState({ mode: 'moov_money', reference: '', telephone: '' });
  const [envoi, setEnvoi] = useState(false);
  const [msg, setMsg] = useState('');

  const charger = useCallback(async () => {
    if (!profil?.iepp_id || !annee) return;
    const { data } = await supabase.from('abonnements').select('*').eq('iepp_id', profil.iepp_id).eq('annee_id', annee.id).maybeSingle();
    setDeclaration(data || null);
    if (data && !['valide', 'paye'].includes(data.statut)) setV({ mode: data.mode, reference: data.reference || '', telephone: data.telephone || '' });
  }, [profil, annee]);
  useEffect(() => { charger(); }, [charger]);

  async function activer(e) {
    e.preventDefault();
    setMsg('');
    if (!v.reference.trim()) return setMsg("Saisissez l'ID de la transaction reçu par SMS après le paiement.");
    setEnvoi(true);
    const { data, error } = await supabase.rpc('activer_abonnement', {
      p_reference: v.reference.trim(), p_mode: v.mode, p_telephone: v.telephone.trim() || null,
    });
    setEnvoi(false);
    if (error) return setMsg(traduireErreur(error));
    if (data === 'active' || data === 'deja_actif') {
      setMsg('active');
      setTimeout(recharger, 1500);
      return;
    }
    setMsg(data === 'code' ? '' : 'attente');
    charger();
  }

  const [code, setCode] = useState('');
  async function saisirCode(e) {
    e.preventDefault();
    setMsg('');
    if (!code.trim()) return setMsg("Saisissez le code d'activation.");
    setEnvoi(true);
    const { error } = await supabase.rpc('utiliser_code_activation', { p_code: code.trim() });
    setEnvoi(false);
    if (error) return setMsg(traduireErreur(error));
    setMsg('active');
    setTimeout(recharger, 1500);
  }

  const etat = declaration ? ETATS[declaration.statut] : null;
  return (
    <div className="ecran-centre fond-abonnement">
      <div className="carte abonnement-bloque">
        <div className="marque"><span className="marque-icone">🎓</span><span>Gestion <b>IEPP</b></span></div>
        <h1>Abonnement {annee?.libelle}</h1>
        <p className="sous-titre">
          <strong>{iepp?.nom || 'Votre circonscription'}</strong> n'a pas d'abonnement en cours pour l'année scolaire {annee?.libelle}.
          L'accès au logiciel est suspendu jusqu'à la validation du paiement.
        </p>

        {config && (
          <div className="tarif">
            <span>Abonnement annuel</span>
            <strong>{fcfa(config.montant, config.devise)}</strong>
            <small>par circonscription, valable jusqu'au {dateFr(finAbonnement(annee, config))} (fin de l'année scolaire {annee?.libelle} + 1 mois)</small>
          </div>
        )}

        {role !== 'iepp' && declaration?.statut === 'paye' ? (
          <div className="alerte">Le paiement de votre circonscription est confirmé. L'inspecteur doit maintenant saisir le code d'activation pour ouvrir l'accès.</div>
        ) : role !== 'iepp' ? (
          <div className="alerte">
            Seul l'inspecteur (compte IEPP) peut régler l'abonnement. Merci de le contacter.
            {config?.contact && <> Gestionnaire : <strong>{config.contact}</strong>.</>}
          </div>
        ) : (
          <>
            {config?.instructions && <p className="instructions">{config.instructions}</p>}
            {config?.contact && <p>Contact / numéro de paiement : <strong>{config.contact}</strong></p>}

            {declaration?.statut === 'paye' && msg !== 'active' && (
              <form className="formulaire bloc-code" onSubmit={saisirCode}>
                <div className="etat-declaration vert">
                  <strong>Paiement confirmé</strong>
                  <span>Voici votre code d'activation pour l'année {annee?.libelle}. Notez-le, puis saisissez-le ci-dessous : il ne peut servir qu'une seule fois.</span>
                </div>
                <div className="code-activation">{declaration.code_activation}</div>
                <label><span>Saisir le code d'activation</span>
                  <input className="champ-id" value={code} placeholder="IEPP-XXXX-XXXX" autoComplete="off" onChange={(e) => setCode(e.target.value)} />
                </label>
                {msg && msg !== 'active' && <p className="erreur">{msg}</p>}
                <div className="actions"><button className="btn" disabled={envoi}>{envoi ? 'Vérification…' : 'Accéder au logiciel'}</button></div>
              </form>
            )}
            {declaration?.statut === 'valide' && msg !== 'active' && (
              <div className="etat-declaration rouge">
                <strong>Abonnement expiré le {dateFr(finAbonnement(annee, config))}</strong>
                <span>Votre abonnement {annee?.libelle} est arrivé à échéance. Réglez le renouvellement puis contactez le gestionnaire{config?.contact ? ` (${config.contact})` : ''} : il ouvrira la nouvelle période et vous pourrez saisir votre nouvel ID de paiement.</span>
              </div>
            )}
            {etat && !['paye', 'valide'].includes(declaration.statut) && msg !== 'active' && (
              <div className={`etat-declaration ${etat[1]}`}>
                <strong>{declaration.statut === 'en_attente' ? 'ID en attente de confirmation' : etat[0]}</strong>
                {declaration.statut === 'en_attente' && <span>L'ID {declaration.reference} a bien été reçu, mais le gestionnaire n'a pas encore confirmé ce paiement. Le logiciel s'activera automatiquement dès sa confirmation : cliquez alors sur « Actualiser ».</span>}
                {declaration.statut === 'refuse' && <span>{declaration.observations || 'Le paiement n’a pas pu être vérifié.'} Vérifiez l'ID et réessayez.</span>}
              </div>
            )}

            {!['valide', 'paye'].includes(declaration?.statut) && (
              <form className="formulaire" onSubmit={activer}>
                <h3>Activer le logiciel avec l'ID de paiement</h3>
                <p className="discret">Après le paiement, vous recevez un SMS contenant l'ID (référence) de la transaction. Saisissez-le ici : chaque ID ne peut servir qu'une seule fois.</p>
                <div className="grille-champs">
                  <label className="pleine"><span>ID de la transaction</span>
                    <input className="champ-id" value={v.reference} placeholder="ex. CI261015.1234.A56789" autoComplete="off" onChange={(e) => setV({ ...v, reference: e.target.value })} />
                  </label>
                  <label><span>Moyen de paiement</span>
                    <select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>
                      {MODES.filter(([k]) => !['gratuit', 'especes'].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <label><span>Numéro qui a payé</span>
                    <input type="tel" value={v.telephone} placeholder="01 00 00 00 00" onChange={(e) => setV({ ...v, telephone: e.target.value })} />
                  </label>
                </div>
                {msg && !['active', 'attente'].includes(msg) && <p className="erreur">{msg}</p>}
                <div className="actions"><button className="btn" disabled={envoi}>{envoi ? 'Vérification…' : 'Activer le logiciel'}</button></div>
              </form>
            )}
            {msg === 'active' && <div className="etat-declaration vert"><strong>Abonnement activé !</strong><span>Merci. Ouverture du logiciel…</span></div>}
          </>
        )}

        <div className="pied-abonnement">
          <span className="discret">{profil?.nom_complet} — {ROLES[role]}</span>
          <span>
            <button className="btn-contour" onClick={recharger}>Actualiser</button>{' '}
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
  const { iepps, annee, actualiser } = useApp();
  const [config, chargerConfig] = useConfig();
  const [abos, setAbos] = useState([]);

  async function basculerExperimentation() {
    const v = !annee.experimentation;
    if (!confirm(v
      ? `Faire de ${annee.libelle} une année d'expérimentation ?\n\nToutes les circonscriptions auront accès GRATUITEMENT au logiciel, sans abonnement.`
      : `Arrêter l'année d'expérimentation ${annee.libelle} ?\n\nLes circonscriptions sans abonnement validé seront aussitôt BLOQUÉES et devront payer.`)) return;
    const { error } = await supabase.from('annees_scolaires').update({ experimentation: v }).eq('id', annee.id);
    if (error) return setMsg(/experimentation/i.test(error.message) ? 'Lancez d’abord le script 019_annee_experimentation.sql dans Supabase.' : traduireErreur(error));
    await actualiser();
  }
  const [filtre, setFiltre] = useState('en_attente');
  const [recherche, setRecherche] = useState('');
  const [edition, setEdition] = useState(null);
  const [tarif, setTarif] = useState(null);
  const [msg, setMsg] = useState('');
  const [vue, setVue] = useState('iepp');

  const charger = useCallback(async () => {
    if (!annee) return;
    const { data, error } = await supabase.from('abonnements').select('*').eq('annee_id', annee.id);
    if (error) setMsg(traduireErreur(error));
    setAbos(data || []);
  }, [annee]);
  useEffect(() => { charger(); }, [charger]);

  const lignes = useMemo(() => iepps.map((i) => ({ iepp: i, abo: abos.find((a) => a.iepp_id === i.id) || null })), [iepps, abos]);
  const compte = (f) => lignes.filter((l) => (f === 'non_paye' ? !l.abo : groupe(l.abo?.statut) === f)).length;
  const encaisse = abos.filter((a) => groupe(a.statut) === 'valide').reduce((t, a) => t + Number(a.montant || 0), 0);
  const t = recherche.trim().toLowerCase();
  const affichees = lignes
    .filter((l) => filtre === 'tous' || (filtre === 'non_paye' ? !l.abo : groupe(l.abo?.statut) === filtre))
    .filter((l) => !t || `${l.iepp.nom} ${l.iepp.drena?.nom || ''}`.toLowerCase().includes(t));

  async function supprimerAbonnement(abo, nomIepp) {
    if (!confirm(`Supprimer l'abonnement ${annee.libelle} de ${nomIepp} ?\n\nLa circonscription sera de nouveau bloquée et l'ID de paiement associé redeviendra disponible.\n(Vous pourrez annuler, ou le restaurer depuis la Corbeille.)`)) return;
    setMsg('');
    const { error } = await supabase.from('abonnements').delete().eq('id', abo.id);
    if (error) return setMsg(traduireErreur(error));
    // l'ID de paiement utilisé par cet abonnement redevient disponible
    await supabase.from('paiements_recus').update({ utilise_iepp: null, utilise_annee: null, utilise_le: null })
      .eq('utilise_iepp', abo.iepp_id).eq('utilise_annee', abo.annee_id);
    signalerSuppression(`Abonnement ${annee.libelle} — ${nomIepp}`);
    charger();
  }

  async function changerStatut(abo, statut, observations) {
    setMsg('');
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('abonnements').update({
      statut: statut === 'valide' ? 'paye' : statut, observations: observations ?? abo.observations, valide_par: statut === 'valide' ? u.user?.id : null, valide_le: statut === 'valide' ? new Date().toISOString() : null,
    }).eq('id', abo.id);
    if (error) setMsg(traduireErreur(error)); else charger();
  }

  async function enregistrerEdition(e) {
    e.preventDefault();
    const { data: u } = await supabase.auth.getUser();
    const ligne = {
      iepp_id: edition.iepp.id, annee_id: annee.id, montant: Number(edition.montant) || 0, mode: edition.mode,
      reference: edition.reference || null, telephone: edition.telephone || null, date_paiement: edition.date_paiement || null,
      observations: edition.observations || null, statut: edition.statut === 'valide' ? 'valide' : 'paye', valide_par: u.user?.id, valide_le: new Date().toISOString(),
    };
    const res = edition.id ? await supabase.from('abonnements').update(ligne).eq('id', edition.id) : await supabase.from('abonnements').insert(ligne);
    if (res.error) return setEdition({ ...edition, erreur: traduireErreur(res.error) });
    setEdition(null);
    charger();
  }

  async function enregistrerTarif(e) {
    e.preventDefault();
    const { error } = await supabase.from('config_abonnement').upsert({ id: 1, montant: Number(tarif.montant) || 0, devise: tarif.devise || 'FCFA', instructions: tarif.instructions || '', contact: tarif.contact || null, date_fin: tarif.date_fin || null, updated_at: new Date().toISOString() });
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
      <div className={`carte experimentation ${annee.experimentation ? 'active' : ''}`}>
        <div>
          <strong>{annee.experimentation
            ? `🧪 Année d'expérimentation ${annee.libelle} : accès gratuit pour toutes les circonscriptions jusqu'au ${dateFr(finGratuite(annee))}`
            : `💳 Année ${annee.libelle} : version payante`}</strong>
          <div className="discret">{annee.experimentation
            ? 'Aucun abonnement n’est demandé cette année. Après cette date, la version payante démarre automatiquement : chaque circonscription devra s’abonner pour l’année scolaire suivante.'
            : 'Les circonscriptions doivent avoir un abonnement validé pour utiliser le logiciel. Toutes les années après 2026-2027 sont payantes automatiquement.'}</div>
        </div>
        {(annee.experimentation || annee.date_debut < '2027-07-01') && (
          <button className={annee.experimentation ? 'btn-contour' : 'btn'} onClick={basculerExperimentation}>
            {annee.experimentation ? 'Arrêter l’expérimentation maintenant' : 'Remettre l’expérimentation'}
          </button>
        )}
      </div>
      {config && <p className="sous-titre">Tarif : <strong>{fcfa(config.montant, config.devise)}</strong> par circonscription et par année scolaire{config.contact ? ` — contact : ${config.contact}` : ''}. Abonnement possible à tout moment de l'année {annee.libelle}, valable jusqu'au <strong>{dateFr(finAbonnement(annee, config))}</strong>{joursAvant(finAbonnement(annee, config)) >= 0 ? ` (fin dans ${joursAvant(finAbonnement(annee, config))} jours)` : ' (période terminée)'}.</p>}

      <div className="onglets">
        <button className={vue === 'iepp' ? 'actif' : ''} onClick={() => setVue('iepp')}>Circonscriptions</button>
        <button className={vue === 'ids' ? 'actif' : ''} onClick={() => setVue('ids')}>ID de paiement reçus</button>
      </div>
      {vue === 'ids' && <IdsRecus config={config} iepps={iepps} apresAjout={charger} />}
      {vue === 'iepp' && (<>
      <div className="grille-stats">
        <div className="carte stat orange"><span>À valider</span><strong>{compte('en_attente')}</strong></div>
        <div className="carte stat vert"><span>Payés</span><strong>{compte('valide')}</strong></div>
        <div className="carte stat rouge"><span>Non payés</span><strong>{compte('non_paye')}</strong></div>
        <div className="carte stat"><span>Montant encaissé</span><strong>{fcfa(encaisse, config?.devise)}</strong></div>
      </div>

      <div className="barre-outils">
        <div className="bascule">
          {[['en_attente', 'À valider'], ['valide', 'Payés / actifs'], ['non_paye', 'Non payés'], ['refuse', 'Refusés'], ['tous', 'Toutes']].map(([k, l]) => (
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
                  <td>{abo ? <>{libelleMode(abo.mode)}{abo.reference && <div className="discret">Réf. {abo.reference}</div>}{abo.telephone && <div className="discret">Tél. {abo.telephone}</div>}{abo.date_paiement && <div className="discret">le {dateFr(abo.date_paiement)}</div>}{abo.code_activation && <div className="code-mini">Code : <strong className="champ-id">{abo.code_activation}</strong>{abo.code_utilise_le ? ` (utilisé le ${dateFr(abo.code_utilise_le.slice(0, 10))})` : ' (non utilisé)'}</div>}</> : '—'}</td>
                  <td className="nombre">{abo ? fcfa(abo.montant, config?.devise) : '—'}</td>
                  <td className="actions-ligne">
                    {abo?.statut === 'en_attente' && <button className="btn petit" onClick={() => changerStatut(abo, 'valide')}>Valider</button>}
                    {abo?.statut === 'en_attente' && <button className="lien" onClick={() => setEdition({ refus: true, abo, observations: '' })}>Refuser</button>}
                    {['valide', 'paye'].includes(abo?.statut) && <button className="lien" onClick={() => changerStatut(abo, 'en_attente')}>Suspendre</button>}
                    {!abo && <button className="btn-contour petit" onClick={() => setEdition({ iepp, montant: config?.montant || 0, mode: 'especes', reference: '', telephone: '', date_paiement: new Date().toISOString().slice(0, 10), observations: '' })}>Enregistrer un paiement</button>}
                    {abo && abo.statut !== 'en_attente' && <button className="lien" onClick={() => setEdition({ iepp, ...abo })}>Modifier</button>}
                    {abo && <button className="lien danger" onClick={() => supprimerAbonnement(abo, iepp.nom)}>Supprimer</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>)}

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
            <p className="discret">En enregistrant, le paiement est confirmé et un code d'activation est généré : il s'affiche à l'inspecteur, qui le saisit pour ouvrir l'accès.</p>
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
              <label className="pleine"><span>Date de fin précise (facultatif — vide = fin de l'année scolaire + 1 mois)</span>
                <input type="date" value={tarif.date_fin || ''} onChange={(e) => setTarif({ ...tarif, date_fin: e.target.value || null })} />
              </label>
              <p className="pleine discret" style={{ margin: 0 }}>Les IEPP peuvent s'abonner à tout moment de l'année {annee.libelle} ; l'accès dure jusqu'au <b>{dateFr(finAbonnement(annee, tarif))}</b>, quel que soit le jour du paiement. Ensuite il est bloqué jusqu'au renouvellement.</p>
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

// =====================================================================
//  ID de paiement reçus (SMS) : chaque ID active UNE SEULE circonscription
// =====================================================================
function IdsRecus({ config, iepps, apresAjout }) {
  const vide = () => ({ reference: '', montant: config?.montant ?? '', mode: 'moov_money', telephone: '', date_reception: new Date().toISOString().slice(0, 10), observations: '' });
  const [liste, setListe] = useState([]);
  const [v, setV] = useState(vide);
  const [msg, setMsg] = useState('');
  const [filtre, setFiltre] = useState('tous');

  const charger = useCallback(async () => {
    const { data, error } = await supabase.from('paiements_recus').select('*').order('created_at', { ascending: false });
    if (error) setMsg(traduireErreur(error));
    setListe(data || []);
  }, []);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { if (config && v.montant === '') setV((x) => ({ ...x, montant: config.montant })); }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ajouter(e) {
    e.preventDefault();
    setMsg('');
    if (!v.reference.trim()) return setMsg("Saisissez l'ID reçu par SMS.");
    const { error } = await supabase.from('paiements_recus').insert({
      reference: v.reference.trim(), montant: v.montant === '' ? null : Number(v.montant), mode: v.mode,
      telephone: v.telephone.trim() || null, date_reception: v.date_reception || null, observations: v.observations || null,
    });
    if (error) return setMsg(/doublon|duplicate/i.test(error.message) ? 'Cet ID est déjà enregistré.' : traduireErreur(error));
    setV(vide());
    setMsg('ok');
    await charger();
    apresAjout();
  }

  async function supprimer(p) {
    if (!confirm(`Supprimer l'ID ${p.reference} ?`)) return;
    const { error } = await supabase.from('paiements_recus').delete().eq('id', p.id);
    if (error) setMsg(traduireErreur(error)); else { signalerSuppression(`ID ${p.reference}`); charger(); }
  }

  const nomIepp = (id) => iepps.find((i) => i.id === id)?.nom || '—';
  const dispo = liste.filter((p) => !p.utilise_le).length;
  const affiches = liste.filter((p) => filtre === 'tous' || (filtre === 'dispo' ? !p.utilise_le : !!p.utilise_le));

  return (
    <>
      <form className="carte formulaire" onSubmit={ajouter}>
        <h3 style={{ marginTop: 0 }}>Enregistrer un ID reçu</h3>
        <p className="discret">Recopiez l'ID figurant sur le SMS de réception du paiement. Si une IEPP a déjà saisi cet ID, son abonnement s'active immédiatement ; sinon l'ID attend qu'une IEPP l'utilise. Chaque ID ne sert qu'une seule fois.</p>
        <div className="grille-champs trois">
          <label><span>ID de la transaction</span><input className="champ-id" value={v.reference} autoComplete="off" onChange={(e) => setV({ ...v, reference: e.target.value })} /></label>
          <label><span>Montant reçu ({config?.devise || 'FCFA'})</span><input type="number" min="0" value={v.montant} onChange={(e) => setV({ ...v, montant: e.target.value })} /></label>
          <label><span>Moyen</span>
            <select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>
              {MODES.filter(([k]) => k !== 'gratuit').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label><span>Numéro de l'expéditeur</span><input type="tel" value={v.telephone} onChange={(e) => setV({ ...v, telephone: e.target.value })} /></label>
          <label><span>Date de réception</span><input type="date" value={v.date_reception} onChange={(e) => setV({ ...v, date_reception: e.target.value })} /></label>
          <label><span>Observation</span><input value={v.observations} placeholder="ex. IEPP de …" onChange={(e) => setV({ ...v, observations: e.target.value })} /></label>
        </div>
        {msg && msg !== 'ok' && <p className="erreur">{msg}</p>}
        {msg === 'ok' && <p className="succes">ID enregistré.</p>}
        <div className="actions"><button className="btn">+ Ajouter l'ID</button></div>
      </form>

      <div className="barre-outils">
        <div className="bascule">
          {[['tous', `Tous (${liste.length})`], ['dispo', `Disponibles (${dispo})`], ['utilise', `Utilisés (${liste.length - dispo})`]].map(([k, l]) => (
            <button key={k} className={filtre === k ? 'actif' : ''} onClick={() => setFiltre(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="tableau-cadre">
        <table className="tableau">
          <thead><tr><th>ID</th><th>Moyen</th><th className="nombre">Montant</th><th>Reçu le</th><th>État</th><th /></tr></thead>
          <tbody>
            {affiches.length === 0 && <tr><td colSpan={6} className="vide">Aucun ID.</td></tr>}
            {affiches.map((p) => (
              <tr key={p.id}>
                <td><strong className="champ-id">{p.reference}</strong>{p.telephone && <div className="discret">de {p.telephone}</div>}{p.observations && <div className="discret">{p.observations}</div>}</td>
                <td>{libelleMode(p.mode)}</td>
                <td className="nombre">{p.montant == null ? '—' : fcfa(p.montant, config?.devise)}</td>
                <td>{dateFr(p.date_reception)}</td>
                <td>{p.utilise_le
                  ? <><span className="badge gris">Utilisé</span><div className="discret">{nomIepp(p.utilise_iepp)} — {dateFr(p.utilise_le.slice(0, 10))}</div></>
                  : <span className="badge vert">Disponible</span>}</td>
                <td className="actions-ligne">{!p.utilise_le && <button className="lien" onClick={() => supprimer(p)}>Supprimer</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// =====================================================================
//  Bandeau d'échéance : « Votre abonnement expire dans N jours »
//  (l'abonnement couvre l'année scolaire : il expire à la date de fin de l'année active)
// =====================================================================
export const SEUIL_ALERTE_JOURS = 30;

/** Fin de la période gratuite : fin de l'année d'expérimentation + 1 mois. */
export function finGratuite(annee) {
  return finAbonnement(annee, null);
}

/** Fin de l'abonnement : date précise du gestionnaire si renseignée, sinon fin de l'année scolaire + 1 mois. */
export function finAbonnement(annee, config) {
  if (config?.date_fin) return config.date_fin;
  if (!annee?.date_fin) return null;
  const [a, m, j] = annee.date_fin.split('-').map(Number);
  const dernier = new Date(a, m + 1, 0).getDate(); // dernier jour du mois suivant
  const d = new Date(a, m, Math.min(j, dernier)); // mois suivant (m est déjà +1 en base 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function joursAvant(dateFin) {
  if (!dateFin) return null;
  const fin = new Date(`${dateFin}T00:00:00`);
  const auj = new Date();
  auj.setHours(0, 0, 0, 0);
  return Math.round((fin - auj) / 86400000);
}

function BandeauExperimentation({ annee }) {
  const cle = `bandeau-experimentation-${annee.id}`;
  const [masque, setMasque] = useState(() => { try { return sessionStorage.getItem(cle) === '1'; } catch { return false; } });
  const fin = finGratuite(annee);
  const jours = joursAvant(fin);
  if (jours !== null && jours < 0) return null;
  const bientot = jours !== null && jours <= SEUIL_ALERTE_JOURS;
  if (masque && !bientot) return null;
  return (
    <div className={`bandeau-abonnement ${bientot ? '' : 'experimentation'}`}>
      {bientot
        ? <span>⏳ <b>La période gratuite se termine {jours === 0 ? "aujourd'hui" : `dans ${jours} jour${jours > 1 ? 's' : ''}`}</b> (le {dateFr(fin)}). Ensuite, la version payante démarre : l'inspecteur devra abonner la circonscription pour la nouvelle année scolaire.</span>
        : <span>🧪 <b>Année d'expérimentation {annee.libelle}</b> — le logiciel est <b>gratuit</b> pour toutes les circonscriptions jusqu'au {dateFr(fin)}. Merci de nous signaler vos remarques.</span>}
      <button className="fermer-barre" aria-label="Masquer" onClick={() => { setMasque(true); try { sessionStorage.setItem(cle, '1'); } catch { /* */ } }}>×</button>
    </div>
  );
}

export function BandeauAbonnement() {
  const { role, annee, abonnementActif } = useApp();
  const [config] = useConfig();
  const [ouvert, setOuvert] = useState(false);
  const fin = finAbonnement(annee, config);
  const jours = config ? joursAvant(fin) : null;
  if (annee?.experimentation) return <BandeauExperimentation annee={annee} />;
  if (role === 'superviseur' || !abonnementActif || jours === null || jours < 0 || jours > SEUIL_ALERTE_JOURS) return null;
  const quand = jours === 0 ? "aujourd'hui" : jours === 1 ? 'demain' : `dans ${jours} jours`;
  return (
    <>
      <div className={`bandeau-abonnement ${jours <= 7 ? 'urgent' : ''}`}>
        <span>⏳ <b>Votre abonnement expire {quand}</b> (le {dateFr(fin)}) — année scolaire {annee.libelle} + 1 mois.</span>
        <button className="btn petit" onClick={() => setOuvert(true)}>Renouveler</button>
      </div>
      {ouvert && (
        <Modal titre="Renouveler l'abonnement" fermer={() => setOuvert(false)}>
          {config && (
            <div className="tarif" style={{ margin: '0 0 14px' }}>
              <span>Abonnement annuel</span>
              <strong>{fcfa(config.montant, config.devise)}</strong>
              <small>par circonscription, pour l'année scolaire suivante</small>
            </div>
          )}
          {role === 'iepp' ? (
            <>
              {config?.instructions && <p className="instructions">{config.instructions}</p>}
              {config?.contact && <p>Numéro de paiement / contact : <b>{config.contact}</b></p>}
              <p className="discret">Conservez le SMS de paiement. Dès l'ouverture de la nouvelle année scolaire, le logiciel vous demandera l'<b>ID de la transaction</b>, puis votre <b>code d'activation</b> : l'accès de toute la circonscription sera rétabli aussitôt.</p>
            </>
          ) : (
            <p>Le renouvellement est réglé par l'<b>inspecteur</b> de votre circonscription. Merci de le prévenir.{config?.contact ? <> Contact du gestionnaire : <b>{config.contact}</b>.</> : null}</p>
          )}
          <div className="actions"><button className="btn" onClick={() => setOuvert(false)}>J'ai compris</button></div>
        </Modal>
      )}
    </>
  );
}
