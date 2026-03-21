import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BookOpen, ChevronDown } from 'lucide-react'

interface FaqSection {
  id: string
  title: string
  icon: string
  items: { q: string; a: string }[]
}

const sections: FaqSection[] = [
  {
    id: 'regles',
    title: 'Règles générales',
    icon: '📋',
    items: [
      {
        q: 'Quelles sont les règles de base de la plateforme ?',
        a: 'Tout joueur doit adopter un comportement respectueux envers ses adversaires et coéquipiers. La triche, les insultes, le spam et toute forme de toxicité sont strictement interdits et entraîneront des sanctions allant du mute au bannissement définitif.',
      },
      {
        q: 'Puis-je jouer avec plusieurs comptes ?',
        a: 'Non. La création de plusieurs comptes (smurf) est interdite. Chaque adresse IP est limitée à 2 comptes. Toute tentative de contournement entraîne un bannissement des comptes concernés.',
      },
      {
        q: 'Que se passe-t-il en cas de déconnexion en cours de partie ?',
        a: 'Si tu te déconnectes, tu peux rejoindre la room via le bouton "Rejoindre une room" sur la page Ranked pendant 90 minutes. Une déconnexion intentionnelle répétée peut être sanctionnée.',
      },
      {
        q: 'Les paris d\'argent réel sont-ils autorisés ?',
        a: 'Non. Cette plateforme utilise un système de points (coins) virtuels sans valeur monétaire réelle. Aucune transaction d\'argent réel n\'a lieu sur notre site.',
      },
    ],
  },
  {
    id: 'rang',
    title: 'Système de rang',
    icon: '🏆',
    items: [
      {
        q: 'Comment fonctionne le système d\'ELO ?',
        a: 'Ton ELO évolue après chaque partie selon un algorithme basé sur la différence de niveau entre les équipes. Battre une équipe plus forte rapporte plus d\'ELO, perdre contre une équipe plus faible en fait perdre davantage.',
      },
      {
        q: 'Quels sont les différents rangs ?',
        a: 'Les rangs sont : Silver (0–550 ELO) → Gold (551–750) → Platinum (751–900) → Diamond (901–1100) → Radiant (1101+). Chaque rang dispose d\'une couleur distinctive et d\'un badge affiché sur ton profil.',
      },
      {
        q: 'Mon ELO est-il partagé entre les modes de jeu ?',
        a: 'Non. Chaque mode (1v1, 2v2, 3v3, 5v5) possède son propre classement ELO indépendant. Tu peux être Gold en 1v1 et Diamond en 5v5.',
      },
      {
        q: 'Quand les saisons se réinitialisent-elles ?',
        a: 'Les saisons durent environ 3 mois. À la fin de chaque saison, les ELOs sont partiellement réinitialisés (soft reset) et les statistiques de la saison précédente sont archivées sur ton profil.',
      },
    ],
  },
  {
    id: 'jouer',
    title: 'Comment jouer',
    icon: '⚔️',
    items: [
      {
        q: 'Comment lancer une partie ?',
        a: 'Va sur la page Ranked, choisis ton mode de jeu, puis clique sur "Rejoindre la file". Tu peux jouer en solo ou créer un groupe avec des amis via le code de groupe.',
      },
      {
        q: 'Comment fonctionne le matchmaking ?',
        a: 'Le matchmaking est basé sur l\'ELO. La fenêtre de recherche commence à ±80 ELO et s\'élargit de 40 points toutes les 45 secondes (maximum ±400) pour garantir une partie dans un délai raisonnable.',
      },
      {
        q: 'Qu\'est-ce que la phase de ban de maps ?',
        a: 'En mode 5v5, avant chaque partie, les deux équipes bannissent alternativement des maps jusqu\'à ce qu\'il n\'en reste qu\'une. Chaque équipe a 15 secondes pour voter, sinon le ban est automatique.',
      },
      {
        q: 'Comment fonctionne le vote d\'arme ?',
        a: 'En modes 1v1, 2v2 et 3v3, les équipes votent pour une arme avant la partie. En cas d\'égalité, l\'arme est choisie aléatoirement parmi les votes.',
      },
      {
        q: 'Comment soumettre le résultat ?',
        a: 'Après la partie, le capitaine de chaque équipe clique sur "Ma team a gagné" ou "Ma team a perdu". Si les deux capitaines sont d\'accord, le résultat est validé automatiquement. En cas de désaccord, un admin est alerté.',
      },
    ],
  },
  {
    id: 'scores',
    title: 'Vérification des scores',
    icon: '📸',
    items: [
      {
        q: 'Comment prouver le résultat d\'une partie ?',
        a: 'Utilise le bouton appareil photo (📷) dans le chat de la room pour envoyer une capture d\'écran du score final. Cette preuve est visible par les deux équipes et les admins.',
      },
      {
        q: 'Que faire en cas de conflit de vote ?',
        a: 'Si les capitaines ne sont pas d\'accord sur le résultat, clique sur "Demander une décision admin". Un staff sera notifié et rejoindra la room pour trancher. Assure-toi d\'avoir envoyé ta capture d\'écran au préalable.',
      },
      {
        q: 'Combien de temps ai-je pour soumettre le résultat ?',
        a: 'Le bouton de vote apparaît 30 secondes après le début de la partie. Les rooms se ferment automatiquement après 90 minutes d\'inactivité sans résultat.',
      },
      {
        q: 'Les screenshots sont-ils obligatoires ?',
        a: 'Fortement recommandés. En cas de litige sans preuve visuelle, l\'admin se basera uniquement sur les témoignages des joueurs, ce qui peut compliquer la décision.',
      },
    ],
  },
  {
    id: 'sanctions',
    title: 'Sanctions',
    icon: '⚠️',
    items: [
      {
        q: 'Quelles sont les sanctions possibles ?',
        a: 'Les sanctions incluent : le mute (impossibilité d\'écrire dans le chat), le ban temporaire ou définitif du compte. La sévérité dépend de la gravité et de la récidive.',
      },
      {
        q: 'Comment signaler un joueur ?',
        a: 'Pendant une partie, utilise le bouton "Signaler un joueur" en bas de l\'écran. Choisis le joueur et la raison (toxicité, triche, AFK, etc.). Un admin sera automatiquement notifié.',
      },
      {
        q: 'Puis-je faire appel d\'un ban ?',
        a: 'Oui. Ouvre un ticket via la page Support en expliquant ta situation. L\'équipe admin examinera ton cas. Les bans pour triche confirmée sont généralement définitifs.',
      },
      {
        q: 'Que risque-t-on pour une fausse déclaration de résultat ?',
        a: 'Déclarer faussement avoir gagné une partie (fraude au résultat) entraîne une suspension immédiate et une réinitialisation de l\'ELO gagné frauduleusement.',
      },
    ],
  },
]

function AccordionItem({ item }: { item: { q: string; a: string } }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      <button
        className="w-full py-4 flex items-start justify-between gap-4 text-left transition-colors"
        onClick={() => setOpen(v => !v)}
        style={{ color: open ? '#e8e8f0' : 'rgba(255,255,255,0.75)' }}
        onMouseEnter={e => (e.currentTarget.style.color = '#e8e8f0')}
        onMouseLeave={e => (e.currentTarget.style.color = open ? '#e8e8f0' : 'rgba(255,255,255,0.75)')}
      >
        <span className="text-sm font-semibold leading-snug">{item.q}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="flex-shrink-0 mt-0.5"
        >
          <ChevronDown size={16} style={{ color: open ? '#ff4655' : 'rgba(255,255,255,0.3)' }} />
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: 'hidden' }}
          >
            <p className="pb-4 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
              {item.a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AccordionSection({ section, index }: { section: FaqSection; index: number }) {
  const [open, setOpen] = useState(index === 0)
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      className="glass-card overflow-hidden"
    >
      <button
        className="w-full px-6 py-5 flex items-center justify-between gap-4"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{section.icon}</span>
          <h2 className="font-display font-bold text-lg">{section.title}</h2>
        </div>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.25 }}>
          <ChevronDown size={18} style={{ color: open ? '#ff4655' : 'rgba(255,255,255,0.3)' }} />
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.3 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-6 pb-2">
              {section.items.map((item, i) => (
                <AccordionItem key={i} item={item} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function FaqPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(255,70,85,0.12)', border: '1px solid rgba(255,70,85,0.3)' }}>
            <BookOpen size={20} style={{ color: '#ff4655' }} />
          </div>
          <div>
            <h1 className="font-display font-bold text-2xl">Règlement & FAQ</h1>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Règles de la plateforme et questions fréquentes</p>
          </div>
        </div>

        <div className="mt-4 px-4 py-3 rounded-xl flex items-start gap-3"
          style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
          <span className="text-base flex-shrink-0">ℹ️</span>
          <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
            En utilisant cette plateforme, tu acceptes de respecter ces règles. Leur non-respect peut entraîner des sanctions.
            En cas de doute, contacte un admin via le <strong>Support</strong>.
          </p>
        </div>
      </motion.div>

      {/* Sections */}
      <div className="space-y-3">
        {sections.map((section, i) => (
          <AccordionSection key={section.id} section={section} index={i} />
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-center text-xs mt-10"
        style={{ color: 'rgba(255,255,255,0.2)' }}
      >
        Ces règles peuvent être mises à jour. Dernière révision : Mars 2026
      </motion.p>
    </div>
  )
}
