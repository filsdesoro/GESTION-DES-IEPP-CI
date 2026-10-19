import { useState } from 'react';
import { useApp } from './contexte.jsx';
import { ChoixEcoleClasse, dateFr, nomComplet, useEcoles } from './Choix.jsx';
import { useInscrits } from './Eleves.jsx';
import { signalerSuppression, supprimerEleve } from './Corbeille.jsx';

export default function CartesScolaires() {
  const { iepp, annee, role } = useApp();
  const peutSupprimer = role !== 'conseiller';
  const [choix, setChoix] = useState({ ecoleId: null, classeId: null });
  const [classe, setClasse] = useState(null);
  const [inscrits, recharger] = useInscrits(choix.classeId);

  async function supprimer(i) {
    if (!confirm(`Supprimer ${nomComplet(i.eleves)} ?\nSon inscription et ses notes de l'année seront effacées.\n(Vous pourrez annuler, ou le restaurer depuis la Corbeille.)`)) return;
    const err = await supprimerEleve(i.id);
    if (err) return alert(err);
    signalerSuppression(nomComplet(i.eleves));
    recharger();
  }
  const ecoles = useEcoles();
  const ecole = ecoles.find((e) => e.id === choix.ecoleId);

  return (
    <div>
      <div className="non-imprime">
        <h1>Cartes scolaires</h1>
        <p className="sous-titre">Cartes d'identité scolaire, 8 par page A4. Découpez en suivant les bordures.</p>
        <ChoixEcoleClasse valeur={choix} changer={(v, c) => { setChoix(v); setClasse(c); }} />
        {inscrits.length > 0 && <div className="barre-outils"><span className="discret">{inscrits.length} carte(s)</span><div className="espace" /><button className="btn" onClick={() => window.print()}>Imprimer les cartes</button></div>}
      </div>
      <div className="planche-cartes">
        {classe && inscrits.map((i) => (
          <div key={i.id} className="carte-scolaire">
            {peutSupprimer && <button className="croix-carte non-imprime" title="Supprimer cet élève" onClick={() => supprimer(i)}>✕</button>}
            <div className="cs-tete">
              <div>RÉPUBLIQUE DE CÔTE D'IVOIRE<br /><small>MENA — {iepp?.nom}</small></div>
              <div className="cs-annee">{annee?.libelle}</div>
            </div>
            <div className="cs-titre">CARTE SCOLAIRE</div>
            <div className="cs-corps">
              <div className="cs-photo">{i.eleves.photo_url ? <img src={i.eleves.photo_url} alt="" /> : 'Photo'}</div>
              <div className="cs-infos">
                <div className="cs-nom">{nomComplet(i.eleves)}</div>
                <div>Né(e) le {dateFr(i.eleves.date_naissance) || '…………'}{i.eleves.lieu_naissance ? ` à ${i.eleves.lieu_naissance}` : ''}</div>
                <div>Sexe : {i.eleves.sexe}</div>
                <div>Classe : <b>{classe.nom}</b></div>
                <div>Matricule : {i.eleves.matricule || '—'}</div>
                <div className="cs-ecole">{ecole?.nom}</div>
              </div>
            </div>
            <div className="cs-pied">Le Directeur</div>
          </div>
        ))}
      </div>
    </div>
  );
}
