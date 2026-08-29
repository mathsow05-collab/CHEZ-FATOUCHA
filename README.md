# 🛍️ CHEZ FATOUCHA — boutique en ligne (catalogue, panier, livraison, Wave / Orange Money)

Site de vente pour la boutique : l'équipe ajoute **ses propres articles** (photo, prix FCFA, tailles,
stock, délai), le client choisit sa taille et sa quantité, voit **la photo, le prix, les frais de
livraison selon sa zone** (ou le retrait gratuit en boutique) et le **délai estimé**, puis **paie
pour valider son panier** — Wave ou Orange Money.

> Dépôt **autonome** (`mathsow05-collab/CHEZ-FATOUCHA`) : une seule app à la racine,
> `render.yaml` du Blueprint **à la racine** → Render le trouve directement.

---

## 1. Démarrer en local

```bash
npm install
cp .env.example .env          # optionnel en dev : des valeurs par défaut existent
npm run check:css             # contrôle du thème (syntaxe, variables, cloisonnement boutique/back-office)
npm run smoke                 # 97 vérifications API + pages servies (boutique, commande, paiement, admin)
npm run test:front            # 55 vérifications du rendu réel (jsdom) : parcours client + espace vendeur
npm start                     # http://localhost:3000
```

| URL | Ce que c'est |
| --- | --- |
| `http://localhost:3000/` | la boutique côté cliente (vraies URLs : `/boutique`, `/produit/<slug>`…) |
| `http://localhost:3000/admin` | **l'espace vendeur — sa propre page (aucun lien côté cliente)** |
| `http://localhost:3000/api/health` | sonde de vie (Render l'utilise) |

Compte admin du premier lancement : variables `ADMIN1_USERNAME` / `ADMIN1_PASSWORD`
(par défaut `admin` / `fatoucha2026` en local — **à changer absolument**).

> L'espace vendeur a **son propre lien** : `/admin` (en local `http://localhost:3000/admin`,
> en ligne `https://<ton-domaine>/admin`). Il n'apparaît **nulle part** dans la boutique :
> aucun lien, aucun bouton, aucun menu, aucune route interne — et ni son HTML, ni son JS,
> ni son CSS ne sont chargés pour une cliente. Mets-le en favori, ou change le chemin avec
> `CHEMIN_ADMIN` (voir `.env.example`) si un jour tu veux qu'il ne s'appelle plus `/admin`.

---

## 2. Ce que fait le site

### Côté client
- **Catalogue** (`/`, `/boutique`, `/categorie/<slug>`) : recherche (touche `/`), filtres catégorie / taille /
  prix / disponibilité, tri, badges promo · « plus que 3 » · rupture, « Voir plus » (le stock s'ajoute, il ne
  remplace pas), et trois rangées personnelles : *Sélection de Fatou*, *Tes favoris*, *Vu récemment*.
- **Fiche produit** (`/produit/<slug>`) : galerie multi-photos avec **loupe** (clic, flèches, molette, pincement),
  **vidéo** de la pièce quand la boutique en a une, description, **taille + coloris** avec stock par variante,
  quantité plafonnée au stock dispo, **prix + disponibilité + délai** regroupés près du CTA, barre d'action
  collante sur mobile, bouton **Partager** (lien copié ou WhatsApp), et sur une rupture :
  **« Préviens-moi quand ça revient »** (numéro gardé, la boutique écrit dès que la pièce revient).
- **Guide des tailles et « Trouver ma taille »** : tableau en centimètres saisi article par article dans
  l'admin, plus un calculateur (taille, poids, coupe préférée) qui propose une taille et l'applique d'un clic.
  La ligne « *Photo portée par Awa, 1,72 m… elle porte du S* » est écrite par la boutique : c'est ce qui
  réduit le plus les retours (mesure = premier motif d'échange dans la mode en ligne).
- **Avis clientes** : note, texte, photo, taille reçue. Un avis **n'est jamais publié tout seul** — soit la
  boutique le valide, soit il vient d'une commande livrée (mention « achat vérifié », publication immédiate).
  La note moyenne et le nombre d'avis sortent dans le HTML et dans le balisage (`aggregateRating`).
- **Recommandations** : « Dans le même esprit » (même catégorie, en stock d'abord) et « Ça complète le look »
  (autre catégorie, prix dans le prolongement) sur la fiche, et « Ça complète ton panier » à l'étape panier.
- **Panier** : quantités modifiables, sous-total, estimation des frais, **code de reprise** (retrouver son
  panier sur un autre téléphone avec son numéro + ce code), bandeau de franchise pour la livraison offerte.
- **Commande** : nom + téléphone, **livraison (zone → tarif + délai)** ou **retrait boutique (gratuit)**,
  adresse/repère, instructions, mode de paiement. Le total est **recalculé serveur** (le client ne peut
  pas envoyer un prix bidon). En espèces, un **acompte** peut être demandé (voir « Règles métier codées »).
- **Paiement** : voir §4.
- **Suivi** : `/suivi` avec référence + numéro (ou les 4 derniers chiffres, ou le code reçu) → timeline
  *reçue → payée → préparation → expédiée → livrée*, total, articles cliquables, bouton
  **« Je confirme que je suis là »**, et après livraison : **« Noter cet article »**.
### Vitesse, référencement et installation (ce que la cliente ne voit pas, Google oui)
- **Rendu serveur** des pages qui comptent : `/`, `/boutique`, `/categorie/<slug>`, `/produit/<slug>`,
  `/faq`, `/retours`, `/livraison`, `/a-propos`. Le titre, le prix, les photos, la note et le fil d'Ariane
  sont dans le HTML reçu, avant n'importe quel JavaScript. Le tunnel d'achat (panier, commande, paiement,
  suivi) reste rendu côté client et est volontairement `noindex`.
- **URLs lisibles** : `/produit/robe-longue-boheme-fleurie`, plus de `#/`. Une vieille URL en `#/produit/5`
  fonctionne encore (elle est réécrite sans rechargement) et `/produit/5` renvoie un **301** vers le slug.
- **Balisage** : `ClothingStore` (accueil), `Product` + `Offer` + `AggregateRating` + `Review` +
  `BreadcrumbList` (fiche), `FAQPage` (questions écrites dans l'admin), sur chaque page rendue.
- **Images à la volée** : `GET /img/<largeur>/<url d'origine>` recadre et sert de l'**AVIF** (ou du WebP si
  le navigateur ne sait pas). Largeurs fermées `220 / 480 / 900 / 1200`, résultat écrit dans
  `data/img-cache` (une fois par fichier et par taille), `Cache-Control: immutable` un an, et partout
  `srcset` + `sizes` + `loading="lazy"` + `width/height` (donc aucun saut de mise en page). Un SVG, un
  fichier manquant ou l'absence de `sharp` ne cassent rien : l'original est servi.
- **`sitemap.xml`** (URLs canoniques uniquement), **`robots.txt`** (`/admin` et `/api/` fermés),
  `canonical`, `og:*` et `twitter:*` sur toute page rendue → l'aperçu WhatsApp d'un lien partagé est propre.
- **PWA** : `public/manifest.webmanifest` + service worker (`/sw.js`) et trois icônes dédiées —
  « Ajouter à l'écran d'accueil » sur Android, et la coquille reste ouverte sans réseau.
- **Mesure sans outil externe** : le front envoie des événements par lots (`vue_fiche`, `ajout_panier`,
  `ouverture_commande`, `paiement_engage`, `commande_validee`, `recherche`, `zoom_photo`, `guide_tailles`,
  `alerte_stock`, `avis_publie`, `clic_whatsapp`) à `/api/evenements`. Rien d'autre n'est gardé : pas de
  cookie, pas de traceur tiers, l'identifiant de session vit en `sessionStorage`.

### Côté admin — `/admin`, une page à part

Le back-office n'est pas une vue de la boutique : ce sont trois fichiers autonomes
(`admin-ui/`) que le serveur ne sert que sur `/admin` (variable `CHEMIN_ADMIN` pour le
déplacer). Ils vivent **hors de `public/`**, donc aucune URL statique ne peut les attraper,
et la boutique ne contient aucun lien vers eux. Le changement d'onglet se fait par hash
interne (`/admin#commandes`) : rien à configurer côté serveur, une seule URL à connaître.
(L'API reste sur `/api/admin/*` derrière jeton de session + mot de passe : connaître une URL
ne donne aucun accès.)


| Onglet | Contenu |
| --- | --- |
| 📊 Tableau de bord | CA du jour / 7 j / total, commandes à payer, à préparer, en route, stock faible, meilleures ventes |
| 👗 Produits | créer / modifier / masquer un article, prix de vente, **prix barré**, **prix d'achat (marge)**, marque, **lien fournisseur (jamais visible côté client)**, délai, **upload de photos par glisser-déposer**, tailles/coloris, **stock par variante**, ★ vedette, importer les photos depuis une URL de fiche, **vidéo de fiche** (fichier téléversé ou lien), **guide des tailles par taille**, ligne « portée par … », légendes de photos |
| 📦 Commandes | recherche (réf., nom, téléphone), filtres par statut, détail, **✔ Paiement reçu**, changement de statut, n° de transaction, **bordereau livreur imprimable**, export CSV |
| ⭐ Avis | file des avis à valider, publier / retirer, **répondre sous l'avis** (la réponse part avec lui), corriger note ou texte, supprimer ; lien vers la fiche telle qu'elle est en ligne |
| 📄 Contenus | réécriture des quatre pages du site (FAQ, retours, livraison, la maison) en markdown léger — `## Une question` devient une question dépliable **et** une entrée `FAQPage` pour Google |
| 📈 Entonnoir | fiches vues → ajouts au panier → commandes commencées → paiements engagés → commandes → payées ; conversion, panier moyen, articles les plus vus, **articles sans avis**, **paniers abandonnés** (bouton WhatsApp de relance), demandes « préviens-moi au retour » à cocher |
| 🚚 Zones & délais | tarif et délai par quartier/région, activation d'une zone, tout est modifiable |
| ⚙️ Réglages | nom, slogan, contacts, adresse/horaires de retrait, **numéros Wave / Orange Money**, livraison offerte à partir de X, expiration des commandes impayées, clés CinetPay, mot de passe |

### Le thème — « Prestige » (boutique et admin)

Registre maison de mode : **ivoire chaud** `#f7f3ec`, **encre aubergine** `#241a22` (jamais de noir
pur), **bordeaux** `#6d1f46` en accent, **or champagne** `#b8912f` en filets, **titres en serif**,
capitales espacées (`.12–.2em`) sur les micro-labels, rayons serrés (`--r: 10px`), hairlines au lieu
d'encadrements, cartes produit sans bordure avec zoom photo au survol, hero sombre à filet or +
visuel éditorial, favicon en monogramme « CF ».

**Les polices sont embarquées, pas espérées.** Fraunces (serif) et Manrope (sans) en variables woff2,
servies depuis `public/media/polices/` et préchargées dans le `<head>` (`npm run smoke` vérifie que
les quatre fichiers sortent du serveur, pas seulement que la feuille les déclare) : le site a la même
tête sur un Android d'entrée de gamme que sur un Mac. `--serif` / `--sans` gardent une pile de repli.

**Les pictogrammes colorés sont bannis de l'interface.** À la place : un jeu de 63 icônes SVG
dessinées à la main (`public/js/icones.js`), trait 1,7, animées au survol et au toucher — recherche,
panier, cœur, menu↔croix, camion qui roule, étiquette, cadenas… Le même module sert au rendu serveur
(`server/pages.js`) et au navigateur, donc la page est déjà ornée avant que le JavaScript parle. Et
comme le champ « marque / origine » ou une description peuvent contenir un emoji, `sansPictos()` le
convertit en tracé : la boutique garde une seule langue graphique.

**Le mouvement est une couche à part** (`public/js/mouvement.js`) : halo qui suit le curseur sur le
hero, reflet sur les photos, boutons légèrement aimantés, carte qui se incline, révélation au
défilement, photo qui vole au panier, étincelles au clic, rails avec flèches. Tout est optionnel par
construction : chaque effet est isolé dans un `try`, `<html>` ne reçoit la classe `mouv` (seule à
masquer un bloc avant sa révélation) que si le script tourne vraiment, et `prefers-reduced-motion`
neutralise l'ensemble — une page ne doit jamais rester vide à cause d'une animation.

Tout part des variables en haut de `public/css/style.css` : `--ivoire`, `--nacre`, `--encre`,
`--bordeaux`, `--or`, `--poussiere`, `--filet`, `--serif`. **Change une ligne, tout le site suit.**
Les noms historiques (`--rose`, `--paper`, `--ink`, `--gold`, `--line`…) restent valables : ce sont
des alias, donc aucun composant n'est cassé si tu les croises dans une règle.

La page du back-office (`admin-ui/admin.css`) reprend exactement les mêmes variables — assortie,
sans rien resservir. Les règles propres à l'admin (tableaux, KPI, grille de stock, glisser-déposer)
ont quitté `style.css` : la cliente ne télécharge pas le CSS du back-office. `npm run check:css`
verrouille les deux : syntaxe, variables réellement définies par les feuilles chargées,
cloisonnement, aucun sélecteur mort. Les contrastes texte/fond sont au niveau AA (4,6:1 à 15:1).

### Cadrage : une page doit tenir dans l'écran

Sur mobile, la navigation horizontale de l'en-tête est remplacée par un bouton et un
**tiroir** (`/admin` excepté : ses pages s'affichent sans JavaScript utile) ; l'aperçu des
actions du haut (« Panier », « Chercher », « Menu ») garde une icône et retire son libellé
sous 900 px. `img { height:auto }` et `svg { height:auto }` sont posés au sommet de la
feuille : sans eux, un `height="1200"` lu dans le HTML étire la photo en bande verticale —
c'est ce que tu voyais « sortir du cadre ». Enfin, `/boutique` a son **propre rendu** (titre
`Tous les articles`, pas de hero, pas de rails) au lieu d'emprunter celui de l'accueil : la
page ne saute plus d'un contenu à l'autre à l'hydratation, et `npm run test:front` le vérifie
en comparant le titre rendu par le serveur avec celui laissé par le client.

### Règles métier codées
- **Stock réservé dès la commande** (décrémenté), **remis en rayon** si la commande est annulée.
- **Annulation automatique** des commandes restées impayées après `expiration_commande_h` (6 h par défaut).
- **Frais de livraison** = tarif de la zone, sauf si le sous-total ≥ `livraison_gratuite_a_partir`
  (35 000 F par défaut) → 0 F ; retrait boutique = toujours 0 F.
- **Délai estimé** = délai d'approvisionnement de l'article le plus long + délai de la zone.
- Numéros sénégalais validés (`77/76/78/70/72…`), anti-brute-force sur le login, limite de commandes/heure.
- **Paiement en espèces gardé, mais encadré** (le COD est un signe de confiance, pas une lubie) : au-delà de
  `cod_acompte_a_partir` (25 000 F par défaut) un **acompte** de `cod_acompte_montant` (2 000 F) est demandé
  avant mise en route ; une cliente qui a déjà laissé deux commandes annulées paie un acompte quel que soit le
  montant. Dans tous les cas la commande part **après confirmation de la cliente** : bouton sur `/paiement`
  et `/suivi`, ou lien `/confirmer/<réf>/<code>` qui marche **sans JavaScript** (un simple formulaire POST),
  ou message WhatsApp pré-rempli. Une référence ou un code qui ne colle pas renvoie une page
  « rien à confirmer » en 404 — jamais un bouton vide. Le code est écrit en clair sur la page et dans le
  bordereau : le livreur le demande à la remise.
- **Variante = taille et/ou coloris** : le stock demandé est la **somme** des variantes qui correspondent,
  donc choisir seulement une taille est légal. Le décrément se répartit du coloris le plus fourni au moins
  fourni ; l'annulation remet tout en rayon.
- **Un PUT de l'admin qui n'envoie pas un champ ne l'efface pas** (photos, guide des tailles, ligne « portée
  par », slug) : un import ou un vieux formulaire ne peut plus vider une fiche.
- **Panier copié côté serveur** (jeton + code de reprise, 30 jours) : reprise sur un autre appareil et liste
  des paniers abandonnés pour relancer. Le numéro seul ne suffit jamais à récupérer un panier.
- **Avis** : celui d'une cliente attend la validation de la boutique ; celui d'une commande **livrée** est
  publié direct et marqué « achat vérifié ». La note moyenne est calculée sur les seuls avis publiés.

---

## 3. Zones de livraison livrées (21 zones, modifiables dans l'admin)

| Groupe | Exemples | Frais | Délai |
| --- | --- | --- | --- |
| Dakar | Plateau/Medina, Almadies/Ngor/Yoff/Ouakam, Mermoz/Sacré-Cœur/Point E | 1 000 F | ~24 h |
| Dakar | Grand Yoff, Liberté 6, Ouest Foire, Sicap, Grand-Dakar, Bango | 1 000 – 1 500 F | 24 – 36 h |
| Banlieue | **Pikine** (Sicage, Niacou-Ndick, Yeumbeul…), Guédiawaye, Rufisque | 2 000 – 2 500 F | 36 – 48 h |
| Régions | Thiès, Mbour, Diourbel, Touba, Kaolack, Fatick, Saint-Louis, Louga, Tambacounda, Ziguinchor, Kolda | 3 000 – 5 000 F | 2,5 – 4 j (nosgara/Yalwa) |

Le retrait en boutique est **gratuit** (adresse et horaires dans ⚙️ Réglages).

---

## 4. Paiement Wave / Orange Money

Le même mécanisme que le reste du dépôt : **CinetPay** (agrégateur sénégalais) quand les clés sont
renseignées, **mode manuel** sinon. Le réglage `mode_paiement` = `auto` | `manuel` | `hybride`.

### Mode A — automatique (le client paie, la commande se valide seule)
1. Ouvrir un compte marchand sur <https://www.cinetpay.com/> (Wave, Orange Money, Free Money, carte).
2. Dans ⚙️ Réglages, coller **Site ID** + **API key** (ou mettre `CINETPAY_SITE_ID` / `CINETPAY_API_KEY`
   dans Render).
3. C'est tout : `POST /api/paiement/checkout` appelle `payment/init`, le bouton **« Payer maintenant »**
   du client ouvre la page de paiement (il choisit Wave ou Orange Money, saisit son numéro, valide avec
   son code secret). `POST /api/paiement/notify` vérifie `payment/check` côté serveur et **passe la
   commande en `payee`** automatiquement ; `GET /api/paiement/retour` sert de filet de sécurité au retour
   navigateur, et le front interroge `/api/paiement/statut/:ref` en attendant.

### Mode B — manuel (fonctionne sans aucun compte)
Le client appuie sur « Valider & payer » → l'écran affiche **le numéro Wave ou Orange Money de la
boutique**, le montant, la référence `CMD-XXXX-XXXX`, un bouton **« Copier le numéro »**, un bouton
**« Ouvrir l'app Wave »** (deep link prérempli) et, pour Orange Money, le raccourci `*155*3*1#`.
Il envoie l'argent puis :
- appuie sur **« J'ai payé — vérifier »** (le site re-interroge le statut), et/ou
- envoie la capture sur **WhatsApp** (lien prérempli avec la référence).

L'admin touche **« ✔ Paiement reçu »** dans 📦 Commandes : la commande passe en préparation.

> On peut encaisser une **caution** plutôt que le total : le pourcentage est dans les réglages,
> il suffit de l'appliquer au montant affiché (mode manuel) ou de changer le `montant` envoyé à
> CinetPay dans `server/paiement.js` si tu veux l'automatiser.

---

## Vidéo de l'article : tu colles le lien, la fiche s'occupe du reste

Dans l'espace vendeur, au bloc « Vidéo & réassurance » : **colle l'URL de la
vidéo que tu as mise sur YouTube** (un Short marche aussi, Vimeo, TikTok et
Instagram sont reconnus pareil), ou téléverse un .mp4 de 20 Mo si tu préfères
garder le fichier ici.

Ce que le site en fait :

- il **reconnaît le lien** et l'affiche aussitôt dans le formulaire (fournisseur,
  format 16:9 ou 9:16) — un lien qu'il ne connaît pas est refusé, il ne devient
  jamais un cadre ;
- il **recopie la miniature** chez lui (`/uploads/produits/…`) : la vignette de la
  fiche ne dépend donc pas de YouTube, et elle passe par le même pipeline AVIF/WebP
  que les photos ;
- la fiche montre la miniature **rangée avec les photos** (une pastille à la fin
  de la pellicule) ;
- **rien ne se charge avant le toucher** : ni cadre, ni script, ni piste du
  tiers. C'est la cliente qui lance la lecture, et là seulement, en plein écran,
  avec un lien pour ouvrir la vidéo chez YouTube si le cadre ne lui plaît pas ;
- le balisage `VideoObject` est ajouté, pour que la vidéo puisse remonter dans les
  résultats Google ;
- chaque lecture est comptée (`lecture_video`), visible dans l'entonnoir.

Une vidéo de 8 à 10 secondes qui montre le tissu qui bouge vaut mieux que trois
photos fixes. Si tu déposes le fichier ici, souviens-toi que le disque de
l'instance gratuite est remis à zéro à chaque redéploiement : le lien YouTube,
lui, ne saute pas.

### Le faire sur le site en ligne, pas à pas

1. Ouvrir `https://chez-fatoucha.onrender.com/admin` — l'adresse n'apparaît
   nulle part sur la boutique, il faut la taper (aucun lien pour que les clientes
   ne tombent jamais dessus).
2. Se connecter avec `ADMIN1_USERNAME` / `ADMIN1_PASSWORD` tels qu'ils sont dans
   Render → ton service → **Environment**. Ce sont eux qui ont servi au premier
   lancement ; il n'y a pas de « mot de passe oublié » sur la page.
3. Onglet **Produits** → le crayon sur l'article → champ **Vidéo de la fiche** →
   coller le lien → **Enregistrer**. Le bandeau sous le champ dit ce qui a été
   reconnu : « YouTube · format paysage (16:9) · lecteur intégré au toucher »,
   « format vertical (9:16) » pour un Short, ou « lien externe · la fiche mettra
   un bouton qui ouvre la vidéo chez le fournisseur » si le lien n'est pas
   intégrable — dans ce cas rien n'est perdu, le lien reste en base.
4. Recharger la fiche côté boutique (une fois suffit : le code est resservi depuis
   le réseau depuis que le service worker ne le met plus en cache prioritaire).

### Les liens qui marchent

`youtube.com/watch?v=…`, `youtu.be/…?si=…` (le lien que le bouton « Partager »
d'un téléphone fabrique), `youtube.com/shorts/…`, `youtube.com/embed/…`,
`youtube.com/live/…`, `vimeo.com/…`, `tiktok.com/@compte/video/…`,
`instagram.com/reel/…`. Les liens courts nés du même bouton (« Partager ») —
`vm.tiktok.com/…`, `vt.tiktok.com/…`, `bit.ly/…`, `t.co/…` — sont acceptés : le
site les déroule et, s'il trouve l'adresse complète, **remplace ce que tu as
collé par cette adresse** dans le formulaire. C'est elle qui est stable ; le
raccourci, lui, peut changer de destination.

Un lien WhatsApp, Facebook ou un fichier qui n'est pas sur le site reste refusé
à dessein : la fiche d'une cliente ne charge rien en dehors des lecteurs listés.

**Les Shorts** (vidéos verticales) sont traités à part, parce que c'est là que
l'affichage casse le plus souvent : le cadre est en 9:16, la fenêtre s'ouvre en
portrait, et la vignette est cherchée au **format d'origine** (`oardefault`) —
l'image par défaut de YouTube, elle, entoure le Short de deux bandes noires et
sur une carte de 42 px on ne voit plus l'article. Si YouTube ne fournit pas
d'image portrait, aucune image n'est rangée : la carte garde le sceau de lecture
sur fond d'encre, jamais les bandes noires ni la photo du produit.

Côté espace vendeur, la liste des articles le dit directement : « 2 articles sur
8 ont une vidéo, dont 2 en Short (portrait) », et chaque ligne porte
*Short · YouTube · miniature rangée* ou la mention discrète *sans vidéo* —
impossible de ne pas voir si l'enregistrement a pris.

### Plus le mot de passe de l'espace vendeur

`ADMIN1_PASSWORD` ne sert qu'à la **création** du compte : le changer dans Render
ne remet pas le mot de passe à plat d'un compte qui existe déjà. Depuis le
**Shell** du service (Render → ton service → Shell), qui voit la même base que la
boutique :

```bash
npm run admin:reset -- --user=admin --pass='un mot de passe solide'
# pour qu'un mot de passe soit inventé et affiché une seule fois :
npm run admin:reset -- --user=admin --genere
npm run admin:reset -- --aide
```

Le compte est créé s'il n'existe pas (première base, ou disque remis à zéro).
Une fois entré, le mot de passe se change aussi de l'intérieur : **Réglages → Sécurité**.

## Images : pourquoi les vignettes sont pré-cuites au build

Les photos du site ne sont pas servies telles quelles : chaque visuel existe en
220, 480, 900 et 1200 px, en AVIF et en WebP. Ces variantes sont calculées à la
demande et rangées dans `DATA_DIR/img-cache`. Or le disque de Render est
**éphémère** : à chaque réveil (et il dort dix minutes après la dernière visite),
le cache est vide — la première visiteuse payait alors une seconde par photo,
pendant que les suivantes ne voyaient rien du tout.

Trois choses ont été faites :

1. **`npm run images:prepare`** (joué par `buildCommand` sur Render, donc pendant
   la construction) pré-cuit **les quatre largeurs** (220/480/900/1200 px, en
   AVIF et WebP) de tous les visuels livrés, dans `.img-cache/` — 216 fichiers,
   3,7 Mo, un peu plus d'une minute de build. La clé de cache est calculée sur un chemin *relatif au dépôt* :
   le serveur qui tourne dans un autre répertoire retrouve les mêmes fichiers.
   Une variante déjà cuite est sautée → le build ne coûte que le premier coup
   (~1 min de build pour 216 variantes, 3,7 Mo).
2. **Réchauffage au démarrage** (`server/rechauffage.js`) : ce que le build ne
   peut pas connaître (photos téléversées, variants manquants) est fabriqué en
   tâche de fond, deux à la fois, après l'ouverture du port — jamais devant une
   requête. L'avancement est visible dans `GET /api/health` (`images`).
3. **Preload** : la photo principale d'une fiche est annoncée dans le `<head>`
   (`<link rel="preload" as="image">`), donc demandée en même temps que la
   feuille de style. Les vignettes, elles, s'arrêtent à 480 px : elles sont
   affichées à ~260 px, inutile de leur faire télécharger du 900 px.

Réglages sans toucher au code : `RECHAUFFE=0` (désactive le réchauffage),
`RECHAUFFE_NB` (nombre d'articles préparés, 16 par défaut), `RECHAUFFE_GRAND`
(nombre de fiches ayant aussi leur grande photo, 8), `PRECUIRE="220,480"`
(largeurs à pré-cuire si un build est trop long).

Mesure sur cette machine, base de données et cache neufs à chaque scénario,
mobile 390 px — « dernière photo » = millisecondes après le début du chargement
jusqu'à la *dernière* image de la page :

| scénario | accueil | fiche | boutique |
| --- | --- | --- | --- |
| rien de préparé (avant) | 4934 ms, une photo jamais arrivée | 3209 ms | 189 ms |
| réchauffage seul | 6963 ms (course contre le visiteur) | 3844 ms | 130 ms |
| pré-cuit au build | 155 ms | 145 ms | 115 ms |
| pré-cuit + réchauffage | 174 ms | 132 ms | 130 ms |

L'outil de mesure est `/home/user/tools/mesure-images.js` (hors dépôt) : il boot
une instance par scénario, cache vide à chaque fois.
## 5. Photos et « lien de l'article »

Le site est pensé pour que l'admin ajoute **ses propres articles** :

- **Glisser-déposer** les photos depuis le téléphone (JPG/PNG/WEBP, 8 Mo max) → elles sont
  enregistrées dans `uploads/produits/` et servies par le site.
- **« Récupérer depuis une URL »** (dans le formulaire produit) : colle le lien de la fiche
  (SHEIN, Temu, Jumia…) → le serveur lit la page, **rapatrie les photos en local**, et pré-remplit
  titre/description. SHEIN bloque souvent la lecture automatique : dans ce cas le site le dit
  clairement (« téléverse tes photos, capture d'écran OK ») et rien ne casse.
  Le **lien fournisseur reste privé** (visible admin) ; le client, lui, voit la marque, la photo, le prix.
- Le prix affiché est toujours **celui de la boutique** (prix de vente saisi par l'admin), jamais celui du site d'origine.

---

## 6. Structure

```
fatoucha/
├── server/
│   ├── index.js       Express : sécurité, API, static, SPA fallback, SIGTERM
│   ├── db.js          schéma SQLite (produits, variantes, commandes, lignes, zones, réglages, logs)
│   ├── catalogue.js   shapes publiques, stock par variante, recommandations, guide des tailles, annulation auto des impayés
│   ├── pages.js       rendu serveur : accueil, boutique, catégorie, fiche, pages, confirmation, sitemap, robots
│   ├── optima.js      images à la volée : /img/<largeur>/… → AVIF/WebP + cache disque (sharp)
│   ├── seed.js        21 zones, catégories (avec slugs), réglages, 8 articles de démo, 4 pages de contenu
│   ├── paiement.js    CinetPay (init/check/notify/retour) + mode manuel Wave/OM + deep links
│   ├── scrape.js      lecture d'une page produit + téléchargement d'image (anti-SSRF)
│   ├── security.js    scrypt, JWT HS256 maison, référence de commande, rate-limit, tel. SN
│   └── routes/
│       ├── boutique.js  API publique (config, produits, commande, suivi)
│       └── admin.js     API admin (auth, produits, variantes, upload, commandes, zones, réglages)
├── public/            front vanilla, sans build :
│   ├── index.html     coquille cliente (le routeur par chemins est dans js/app.js)
│   ├── manifest.webmanifest · sw.js   PWA : icônes, « ajouter à l'accueil », coquille hors-ligne
│   ├── css/style.css  thème (variables) + boutique — rien de propre à l'admin
│   ├── js/            api.js (aides partagées) · app.js (parcours cliente uniquement)
│   └── media/         visuels de démo, favicon
├── admin-ui/          LE BACK-OFFICE, hors de public/ (invisible par URL statique) :
│   ├── index.html     gabarit (le serveur y injecte CHEMIN_ADMIN) — login plein écran
│   ├── admin.js       tableau de bord, commandes, produits, zones, réglages
│   └── admin.css      chrome assorti + règles admin extraites du CSS public
├── scripts/           smoke-test.js (API + pages), front-test.js (jsdom),
│                      check-css.js (thème), make-demo-images.js (visuels de démo)
├── data/              base SQLite (créée au 1er lancement, non commitée)
├── uploads/produits/  photos téléversées (non commitées)
├── .gitignore  ├── .env.example  ├── render.yaml (Blueprint, à la racine)  └── Dockerfile
```

Dépendances : `express`, `better-sqlite3`, `multer` — et rien d'autre en production
(`jsdom` et `postcss` en dev, pour les tests uniquement). Pas de build : le front est servi tel quel.

---

## 7. Déployer sur Render

### Méthode « Blueprint » (recommandée — c'est pour ça que `render.yaml` est à la racine)
1. Pousse ce projet sur **ta branche `main`** du dépôt `CHEZ-FATOUCHA` (un dépôt vide = erreur
   « Blueprint file `render.yaml` not found on main branch »).
2. Render → **New + → Blueprint** → sélectionne `mathsow05-collab/CHEZ-FATOUCHA` →
   Render affiche **1 nouveau service `chez-fatoucha`**.
3. Renseigne les variables marquées `sync: false` : `ADMIN1_USERNAME`, `ADMIN1_PASSWORD`,
   éventuellement `CHEMIN_ADMIN` (déplacer le back-office hors de `/admin`),
   (optionnel) `CINETPAY_SITE_ID`, `CINETPAY_API_KEY`. `JWT_SECRET` est généré tout seul.
4. **Create Blueprint** → build → l'URL est du genre `https://chez-fatoucha.onrender.com`.
5. Ensuite, chaque `git push` sur `main` redéploie automatiquement.

Paramètres utilisés (et vérifiables dans Settings) : runtime Node · plan `free` · région
`frankfurt` · build `npm install --omit=dev --no-audit --no-fund` · start
`node server/index.js` · health check `/api/health`. **Ne définis pas `PORT`** : Render l'injecte.

### Méthode « Web Service » classique
New → Web Service → repo → *Advanced* → Runtime Node, puis les mêmes Build/Start/Health que ci-dessus
et les mêmes variables d'environnement. Utile si tu ne veux pas lier un Blueprint.

### Persistance (à lire avant d'ouvrir la boutique)
Plan gratuit = disque éphémère : commandes et photos repartent du seed à chaque déploiement.
Pour conserver : Render **Starter** + *Disk* monté sur `/var/data/fatoucha`, avec
`DATA_DIR=/var/data/fatoucha` et `UPLOADS_DIR=/var/data/fatoucha/uploads` (blocs dé-commentés
dans `render.yaml`). Alternative gratuite : sauvegarder régulièrement `data/fatoucha.db` + `uploads/`
(ex. cron + `curl` vers un stockage, ou copier après chaque grosse journée).

## 8. Sécurité (ce qui est déjà fait)

- Mots de passe **scrypt**, sessions **JWT HS256** (12 h), aucune dépendance externe.
- `JWT_SECRET` obligatoire en prod (sinon secret temporaire + avertissement).
- Prix **toujours recalculés serveur** ; le client ne peut ni fixer un prix ni commander plus que le stock.
- **Anti-SSRF** sur l'import d'images : http/https seulement, DNS résolu et vérifié (pas de `127.0.0.1`,
  `10/8`, `172.16/12`, `192.168/16`, `169.254.169.254`), redirections re-vérifiées, 8 Mo max.
- Upload : type MIME image vérifié, extension forcée, nom aléatoire, 8 Mo/fichier, 10 fichiers.
- `X-Content-Type-Options`, `Referrer-Policy`, CSP (`script-src 'self'`, `frame-ancestors 'none'`),
  routes admin derrière Bearer, rate-limit login (8/10 min) et commandes (12/10 min),
  limitation de longueur sur tous les champs, journal `logs` des actions.
- Aucune fuite du prix d'achat ni du lien fournisseur dans l'API publique ; clé API CinetPay masquée en lecture.

## 9. Tests

```bash
npm run check:css    # 8 checks : thème (palette Prestige), variables réellement définies, aucun
                     # sélecteur mort (le CSS qui ne sert à rien est une dette), cloisonnement
                     # boutique / back-office
npm run smoke        # 220 checks : catalogue, commande, stock par variante, paiement, admin, zones,
                     # sécurité ; rendu serveur + balisage + sitemap + robots ; polices réellement servies ; pipeline d'images
                     # (AVIF plus léger que WebP, cache disque, chemin tordu refusé) ; avis et
                     # modération ; alertes de retour en stock ; panier enregistré et reprise ;
                     # événements et entonnoir ; pages de contenu (markdown, échappement) ;
                     # acompte COD et confirmation ; « rien, côté cliente, ne mène au back-office »
npm run test:front   # 107 checks : parcours client réel dans un DOM (jsdom) — catalogue filtré, fiche
                     # (vignettes, loupe, guide, calculateur de taille, avis envoyé), panier et reprise,
                     # commande, paiement, suivi — puis back-office dans sa propre fenêtre (avis,
                     # contenus, entonnoir, création d'un article avec guide et réassurance).
                     # Chaque URL est aussi comparée « serveur vs client » : un titre qui change à l'hydratation
                     # est une page qui saute aux yeux, donc c'est une erreur.
                     # Le test échoue si la moindre erreur JavaScript apparaît pendant le parcours.
```

## 10. Dépannage

| Symptôme | Cause / solution |
| --- | --- |
| Page blanche | `npm install` puis `npm start` : il n'y a **aucun build** à faire, le front est servi tel quel |
| « Blueprint file `render.yaml` not found on main branch » | dépôt vide (rien poussé) **ou** `render.yaml` absent de la racine de la branche choisie — vérifie `github.com/<toi>/<repo>/blob/main/render.yaml` |
| Render renvoie 404 sur `/api/health` | mauvais Root Directory (monorepo) ou service lancé sur le mauvais dépôt |
| Commandes perdues après un redéploiement | plan gratuit sans disque → voir §7 |
| « Le prestataire de paiement ne répond pas » | pas de clés CinetPay → mode manuel utilisé (normal) ; ou clés invalides → vérifier Site ID/API key |
| Je ne vois pas l'espace admin dans la boutique | voulu : aucun lien n'y mène. Ouvre directement `https://<ton-domaine>/admin` |
| `/admin` affiche le catalogue | c'était l'ancien code : vide le cache (Maj+F5). La page du back-office doit contenir `id="adm-root"` dans son code source |
| J'ai changé `CHEMIN_ADMIN` et ça marche plus | redémarre le serveur (variable lue au démarrage) ; le chemin doit être une seule tranche, ex. `/gestion` |
| Écran de connexion qui ne se passe pas bien | le code source de la page doit contenir `id="adm-root"` (sinon c'est un ancien cache : Maj+F5) |
| Import d'URL sans photo | SHEIN/Temu bloquent la lecture : téléverse la photo depuis ton téléphone |
| Une photo distante ne s'affiche pas chez le client | elle doit être rapatriée (bouton *Ajouter* du champ URL) — le site ne hotlinke pas |
| Besoin de repartir de zéro | supprimer `data/fatoucha.db` et relancer (les réglages/zones/produits de démo sont re-seed) |
