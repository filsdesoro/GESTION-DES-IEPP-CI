import { useCallback, useEffect, useState } from 'react';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
import Modal from './Modal.jsx';

/**
 * Messages prédéfinis fournis avec le logiciel.
 * {annee}, {iepp}, {moi}, {date} sont remplacés automatiquement.
 * Les passages entre [crochets] sont à compléter.
 */
export const MODELES_FOURNIS = [
  {
    groupe: 'Réunions et convocations',
    titre: 'Convocation à une réunion',
    objet: 'Convocation à la réunion du [date]',
    corps: `Bonjour,

Vous êtes convié(e) à une réunion qui se tiendra le [date] à [heure], à [lieu].

Ordre du jour :
1. [point 1]
2. [point 2]
3. Divers

Votre présence est vivement souhaitée.

Cordialement,
{moi}
{iepp}`,
  },
  {
    groupe: 'Réunions et convocations',
    titre: 'Report d’une réunion',
    objet: 'Report de la réunion du [date prévue]',
    corps: `Bonjour,

La réunion prévue le [date prévue] est reportée au [nouvelle date] à [heure], même lieu.

Merci de prendre vos dispositions.

Cordialement,
{moi}`,
  },
  {
    groupe: 'Réunions et convocations',
    titre: 'Animation pédagogique / formation',
    objet: 'Animation pédagogique du [date]',
    corps: `Bonjour,

Une animation pédagogique sur le thème « [thème] » est organisée le [date] à [heure], à [lieu].

Sont concernés : [enseignants / directeurs concernés].
Prière de vous munir de [documents ou matériel].

Comptant sur votre participation.

{moi}
{iepp}`,
  },
  {
    groupe: 'Saisie et données',
    titre: 'Rappel : saisie des notes',
    objet: 'Rappel – saisie des notes de [composition]',
    corps: `Bonjour,

La saisie des notes de la composition de [mois] doit être terminée au plus tard le [date limite].

Le « Suivi de la saisie » montre que votre école n'a pas encore terminé. Merci de compléter la saisie dans le logiciel (Compositions → Saisir les notes) avant cette date.

Merci pour votre diligence.

{moi}
{iepp}`,
  },
  {
    groupe: 'Saisie et données',
    titre: 'Mise à jour des effectifs',
    objet: 'Mise à jour des effectifs – année {annee}',
    corps: `Bonjour,

Merci de vérifier et de mettre à jour dans le logiciel les effectifs de votre école (élèves inscrits par classe, garçons et filles) au plus tard le [date limite].

Les données serviront à l'élaboration des statistiques de la circonscription.

Cordialement,
{moi}`,
  },
  {
    groupe: 'Saisie et données',
    titre: 'Demande de rapport / statistiques',
    objet: 'Demande de [rapport de rentrée / statistiques]',
    corps: `Bonjour,

Je vous prie de bien vouloir me transmettre [le rapport de rentrée / les statistiques de …] de votre école au plus tard le [date limite].

Les éléments attendus :
- [élément 1]
- [élément 2]

Cordialement,
{moi}
{iepp}`,
  },
  {
    groupe: 'Examens',
    titre: 'CEPE : liste des candidats',
    objet: 'CEPE {annee} – vérification de la liste des candidats',
    corps: `Bonjour,

En vue du CEPE, merci de vérifier dans le logiciel (Convocations CEPE → Candidats par école) la liste des élèves de CM2 inscrits comme candidats, ainsi que les extraits de naissance manquants.

Date limite de vérification : [date limite].

Cordialement,
{moi}`,
  },
  {
    groupe: 'Examens',
    titre: 'Convocations CEPE disponibles',
    objet: 'Convocations CEPE {annee} disponibles',
    corps: `Bonjour,

Les convocations des candidats au CEPE sont disponibles dans le logiciel (Convocations CEPE → Convocations). Merci de les imprimer et de les remettre aux candidats avant le [date].

Rappel : les candidats doivent se présenter au centre munis de leur convocation et de leur extrait d'acte de naissance, 30 minutes avant le début des épreuves.

{moi}`,
  },
  {
    groupe: 'Visites et inspections',
    titre: 'Annonce d’une visite de classe',
    objet: 'Visite de classe du [date]',
    corps: `Bonjour,

Je vous informe d'une visite de classe le [date] à partir de [heure] à l'école [nom de l'école].

Merci de tenir à disposition : le cahier de préparation, le registre d'appel, les cahiers des élèves et l'emploi du temps.

Cordialement,
{moi}`,
  },
  {
    groupe: 'Administration',
    titre: 'Note d’information',
    objet: 'Note d’information – [objet]',
    corps: `Bonjour à toutes et à tous,

Pour information : [contenu de l'information].

Merci d'en assurer la diffusion auprès de [personnes concernées].

{moi}
{iepp}`,
  },
  {
    groupe: 'Administration',
    titre: 'Transmission de documents',
    objet: 'Transmission de [documents]',
    corps: `Bonjour,

Merci de transmettre à l'inspection [documents demandés] au plus tard le [date limite], par [moyen de transmission].

Cordialement,
{moi}`,
  },
  {
    groupe: 'Réponses courtes',
    titre: 'Accusé de réception',
    objet: 'Accusé de réception',
    corps: `Bonjour,

Bien reçu, merci. Je prends bonne note.

Cordialement,
{moi}`,
  },
  {
    groupe: 'Réponses courtes',
    titre: 'Remerciements',
    objet: 'Remerciements',
    corps: `Bonjour,

Je vous remercie pour [votre participation / votre travail / votre diligence].

Cordialement,
{moi}`,
  },
  {
    groupe: 'Réponses courtes',
    titre: 'Empêchement / absence',
    objet: 'Empêchement – [réunion / activité] du [date]',
    corps: `Bonjour,

Je ne pourrai malheureusement pas être présent(e) le [date] pour [motif]. [Je me fais représenter par … / Je reste joignable au …].

Avec mes excuses,
{moi}`,
  },
];

/** Remplace {annee}, {iepp}, {moi}, {date}. */
export function remplirVariables(texte, { annee, iepp, profil }) {
  return (texte || '')
    .replaceAll('{annee}', annee?.libelle || '')
    .replaceAll('{iepp}', iepp?.nom || '')
    .replaceAll('{moi}', profil?.nom_complet || '')
    .replaceAll('{date}', new Date().toLocaleDateString('fr-FR'));
}

/** Modèles enregistrés (les miens + ceux partagés). */
function useModelesPerso() {
  const [liste, setListe] = useState([]);
  const [installe, setInstalle] = useState(true);
  const charger = useCallback(async () => {
    const { data, error } = await supabase.from('modeles_messages').select('*').order('titre');
    if (error) { setInstalle(false); setListe([]); return; }
    setInstalle(true);
    setListe(data || []);
  }, []);
  useEffect(() => { charger(); }, [charger]);
  return [liste, charger, installe];
}

const PORTEES = { moi: 'Moi seul', circ: 'Toute ma circonscription', tous: 'Tout le monde' };

/**
 * Bouton « 📋 Messages prédéfinis » : choisir un modèle (objet + texte),
 * ou enregistrer le message en cours comme modèle.
 */
export function ChoixModele({ objet, corps, appliquer, libelleObjet = 'Objet' }) {
  const ctx = useApp();
  const { profil, role, ieppId } = ctx;
  const [ouvert, setOuvert] = useState(false);
  const [enregistrer, setEnregistrer] = useState(null);
  const [perso, recharger, installe] = useModelesPerso();
  const [filtre, setFiltre] = useState('');

  function choisir(m) {
    if ((objet || corps) && !confirm('Remplacer le texte déjà écrit par ce modèle ?')) return;
    appliquer({ objet: remplirVariables(m.objet, ctx), corps: remplirVariables(m.corps, ctx) });
    setOuvert(false);
  }
  async function sauver() {
    if (!enregistrer.titre?.trim()) return setEnregistrer({ ...enregistrer, erreur: 'Donnez un nom au modèle.' });
    const { error } = await supabase.from('modeles_messages').insert({
      auteur_id: profil.id, titre: enregistrer.titre, objet: objet || '', corps,
      portee: enregistrer.portee, iepp_id: enregistrer.portee === 'circ' ? ieppId : null,
    });
    if (error) return setEnregistrer({ ...enregistrer, erreur: /relation|schema cache/i.test(error.message) ? 'Lancez d’abord le script 023_modeles_messages.sql dans Supabase.' : traduireErreur(error) });
    setEnregistrer(null);
    recharger();
  }
  async function supprimer(m) {
    if (!confirm(`Supprimer le modèle « ${m.titre} » ?`)) return;
    const { error } = await supabase.from('modeles_messages').delete().eq('id', m.id);
    if (error) return alert(traduireErreur(error));
    recharger();
  }

  const t = filtre.trim().toLowerCase();
  const garde = (m) => !t || `${m.titre} ${m.objet} ${m.corps}`.toLowerCase().includes(t);
  const groupes = [...new Set(MODELES_FOURNIS.map((m) => m.groupe))];
  const mesModeles = perso.filter((m) => m.auteur_id === profil.id && garde(m));
  const partages = perso.filter((m) => m.auteur_id !== profil.id && garde(m));
  const portees = role === 'superviseur' ? ['moi', 'circ', 'tous'] : role === 'iepp' ? ['moi', 'circ'] : ['moi'];

  return (
    <>
      <div className="barre-modeles">
        <button type="button" className="btn-contour petit" onClick={() => setOuvert(true)}>📋 Messages prédéfinis</button>
        {corps?.trim() && <button type="button" className="btn-contour petit" onClick={() => setEnregistrer({ titre: objet || '', portee: 'moi' })}>💾 Enregistrer comme modèle</button>}
        {/\[[^\]]+\]/.test(`${objet} ${corps}`) && <span className="discret">✏️ Complétez les passages entre [crochets] avant d’envoyer.</span>}
      </div>

      {ouvert && (
        <Modal titre="Messages prédéfinis" fermer={() => setOuvert(false)}>
          <input className="recherche large" placeholder="Rechercher un modèle…" value={filtre} onChange={(e) => setFiltre(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} autoFocus />
          <div className="liste-modeles">
            {mesModeles.length > 0 && <div className="groupe-modeles"><h4>Mes modèles</h4>
              {mesModeles.map((m) => (
                <div key={m.id} className="ligne-modele">
                  <button type="button" onClick={() => choisir(m)}><b>{m.titre}</b><span>{m.objet}</span></button>
                  {m.portee !== 'moi' && <span className="badge">{PORTEES[m.portee]}</span>}
                  <button type="button" className="lien danger" onClick={() => supprimer(m)}>Supprimer</button>
                </div>
              ))}
            </div>}
            {partages.length > 0 && <div className="groupe-modeles"><h4>Partagés avec moi</h4>
              {partages.map((m) => (
                <div key={m.id} className="ligne-modele">
                  <button type="button" onClick={() => choisir(m)}><b>{m.titre}</b><span>{m.objet}</span></button>
                  <span className="badge">{PORTEES[m.portee]}</span>
                  {role === 'superviseur' && <button type="button" className="lien danger" onClick={() => supprimer(m)}>Supprimer</button>}
                </div>
              ))}
            </div>}
            {groupes.map((g) => {
              const liste = MODELES_FOURNIS.filter((m) => m.groupe === g && garde(m));
              return liste.length > 0 && (
                <div key={g} className="groupe-modeles"><h4>{g}</h4>
                  {liste.map((m) => (
                    <div key={m.titre} className="ligne-modele">
                      <button type="button" onClick={() => choisir(m)}><b>{m.titre}</b><span>{remplirVariables(m.objet, ctx)}</span></button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          {!installe && <p className="discret">Pour enregistrer vos propres modèles, lancez le script 023_modeles_messages.sql dans Supabase.</p>}
        </Modal>
      )}

      {enregistrer && (
        <Modal titre="Enregistrer comme modèle" fermer={() => setEnregistrer(null)}>
          <div className="formulaire">
            <label>Nom du modèle<input value={enregistrer.titre} onChange={(e) => setEnregistrer({ ...enregistrer, titre: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sauver(); } }} autoFocus /></label>
            {portees.length > 1 && (
              <label>Visible par
                <select value={enregistrer.portee} onChange={(e) => setEnregistrer({ ...enregistrer, portee: e.target.value })}>
                  {portees.map((p) => <option key={p} value={p}>{PORTEES[p]}</option>)}
                </select>
              </label>
            )}
            <p className="discret">Le modèle reprend {libelleObjet === 'Titre' ? 'le titre' : 'l’objet'} et le texte actuels. Astuce : mettez entre [crochets] ce qui change à chaque envoi (date, lieu…).</p>
            {enregistrer.erreur && <p className="erreur">{enregistrer.erreur}</p>}
            <div className="actions">
              <button type="button" className="btn-contour" onClick={() => setEnregistrer(null)}>Annuler</button>
              <button type="button" className="btn" onClick={sauver}>Enregistrer</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
