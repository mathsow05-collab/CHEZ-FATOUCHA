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
npm run smoke                 # 90 vérifications API + pages servies (boutique, commande, paiement, admin)
npm run test:front            # 53 vérifications du rendu réel (jsdom) : parcours client + espace vendeur
npm start                     # http://localhost:3000
```

| URL | Ce que c'est |
| --- | --- |
| `http://localhost:3000/#/` | la boutique côté cliente |
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
- **Catalogue** : recherche (touche `/`), filtres par catégorie, tri par prix, badges promo / « plus que 3 » / rupture.
- **Fiche produit** : galerie photo, description, **choix de la taille et du coloris**, quantité plafonnée
  au stock de la variante, prix, **délai d'approvisionnement**, rappel des moyens de paiement.
- **Panier** : quantités modifiables, sous-total, frais de livraison estimés.
- **Commande** : nom + téléphone, **livraison (zone → tarif + délai)** ou **retrait boutique (gratuit)**,
  adresse/repère, instructions, mode de paiement. Le total est **recalculé serveur** (le client ne peut
  pas envoyer un prix bidon).
- **Paiement** : voir §4.
- **Suivi** : `#/suivi` avec référence + numéro → timeline *reçue → payée → préparation → expédiée → livrée*,
  total, articles, délai estimé, bouton WhatsApp, annulation tant que rien n'est payé.

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
| 👗 Produits | créer / modifier / masquer un article, prix de vente, **prix barré**, **prix d'achat (marge)**, marque, **lien fournisseur (jamais visible côté client)**, délai, **upload de photos par glisser-déposer**, tailles/coloris, **stock par variante**, ★ vedette, importer les photos depuis une URL de fiche |
| 📦 Commandes | recherche (réf., nom, téléphone), filtres par statut, détail, **✔ Paiement reçu**, changement de statut, n° de transaction, **bordereau livreur imprimable**, export CSV |
| 🚚 Zones & délais | tarif et délai par quartier/région, activation d'une zone, tout est modifiable |
| ⚙️ Réglages | nom, slogan, contacts, adresse/horaires de retrait, **numéros Wave / Orange Money**, livraison offerte à partir de X, expiration des commandes impayées, clés CinetPay, mot de passe |

### Le thème (boutique et admin)

Rose poudré, prune, lilas, doré, gros arrondis : tout part des variables en haut de
`public/css/style.css` — `--ink: #3a1a30` (prune, jamais noir), `--paper: #fdf2f6`,
`--rose: #d9558a`, `--rose-2: #b23267`, `--rose-soft`, `--blush`, `--lilac`, `--gold`,
`--line`, `--r: 20px` / `--r-lg: 28px`, `--serif` pour les titres. Change une ligne, tout le site suit. La page du back-office
(`admin-ui/admin.css`) reprend exactement les mêmes variables — elle est assortie à la
boutique sans la resservir. Les règles propres à l'admin (tableaux, KPI, grille de stock,
glisser-déposer) ont quitté `style.css` : la cliente ne télécharge pas le CSS du back-office.

### Règles métier codées
- **Stock réservé dès la commande** (décrémenté), **remis en rayon** si la commande est annulée.
- **Annulation automatique** des commandes restées impayées après `expiration_commande_h` (6 h par défaut).
- **Frais de livraison** = tarif de la zone, sauf si le sous-total ≥ `livraison_gratuite_a_partir`
  (35 000 F par défaut) → 0 F ; retrait boutique = toujours 0 F.
- **Délai estimé** = délai d'approvisionnement de l'article le plus long + délai de la zone.
- Numéros sénégalais validés (`77/76/78/70/72…`), anti-brute-force sur le login, limite de commandes/heure.

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
│   ├── catalogue.js   shapes publiques, stock réservé, annulation auto des impayés
│   ├── paiement.js    CinetPay (init/check/notify/retour) + mode manuel Wave/OM + deep links
│   ├── scrape.js      lecture d'une page produit + téléchargement d'image (anti-SSRF)
│   ├── security.js    scrypt, JWT HS256 maison, référence de commande, rate-limit, tel. SN
│   └── routes/
│       ├── boutique.js  API publique (config, produits, commande, suivi)
│       └── admin.js     API admin (auth, produits, variantes, upload, commandes, zones, réglages)
├── public/            front vanilla, sans build :
│   ├── index.html     coquille cliente (le routeur à # est dans js/app.js)
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
npm run check:css    # 8 checks : thème (palette féminine), variables, cloisonnement CSS
npm run smoke        # 90 checks : catalogue, commande, stock, paiement, admin, zones, sécurité,
                     # + « le back-office a sa propre page, ses fichiers sont injoignables
                     #  et rien, côté cliente, n'y mène ou ne les contient »
npm run test:front   # 53 checks : parcours client réel dans un DOM (jsdom), puis back-office
                     # ouvert sur son chemin privé dans sa propre fenêtre (onglets, produits,
                     # commandes, validation du paiement)
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
