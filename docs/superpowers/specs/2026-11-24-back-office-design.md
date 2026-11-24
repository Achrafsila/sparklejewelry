# Sparkle — Back-office : conception

Date : 2026-11-24 · Branche : `feat/back-office` · Statut : à valider

## 1. Intention

Sparkle vend des bijoux, surtout par messages privés Instagram. Le back-office est l'outil quotidien de la gérante (un seul compte) pour :

- réceptionner les arrivages et tenir un stock juste, référence par référence ;
- composer des offres (à l'unité, trio fixe, trio à composer) sur ce stock commun ;
- saisir vite une commande depuis le téléphone pendant une conversation, en réservant les bonnes pièces ;
- préparer, expédier, puis suivre chaque colis jusqu'au versement du transporteur ou jusqu'au retour ;
- lire la marge réelle d'une période.

La future boutique en ligne passera ses commandes sur le même catalogue et le même stock. Elle n'est pas construite ici, mais la logique serveur qu'elle appellera l'est.

Un bon résultat : une commande saisie au téléphone en moins d'une minute, aucune survente, aucune pièce réservée ou remise en stock deux fois, et un écart de versement visible le jour où il apparaît.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs** : les rubriques Stock, Offres, Commandes, Préparation, Suivi et Pilotage, plus Réglages et Connexion. L'outil doit être utilisable à 390 px comme sur ordinateur, connecté à une base partagée et sécurisée, avec les scénarios de vérification de la demande exécutés.

**Non-objectifs** (hors de cette livraison) :
- la boutique publique, le paiement en ligne et l'intégration des API des transporteurs ;
- plusieurs comptes ou des rôles différents ;
- les remises négociées par commande. Le prix vient de l'offre. *À signaler si les DM en comportent.*
- un thème sombre : l'interface reste claire, mais elle reste lisible quand l'appareil est en mode sombre ;
- l'attribution du budget publicitaire à une commande ;
- le nettoyage automatique des photos orphelines.

**Anti-objectifs** (échec même si « ça marche ») :
- une survente, ou une réservation en double après un nouvel envoi ;
- une double remise en stock lors d'un retour ;
- un historique de commande qui change quand une offre est modifiée ;
- un texte illisible dans un champ (mode sombre, autocomplétion) ;
- des bannières, des gros chiffres décoratifs, du verre derrière une zone de saisie.

## 3. Décisions prises ensemble

| Sujet | Décision |
|---|---|
| Services | Supabase (Postgres, connexion, photos) + Vercel (fichiers statiques) |
| Données du prototype | Données de test uniquement. On repart à zéro, avec un import du format du prototype en option. |
| Accès | Un seul compte administrateur |
| Canaux | Instagram (saisie manuelle) et Site (futur, commande créée par le site lui-même) |
| Versements | Virement groupé avec relevé ; le transporteur **déduit ses frais** (transport, retours) |
| Paiement | À la livraison uniquement |
| Livraison | Tout ou rien : colis livré en entier ou retourné en entier |
| Coût des pièces vendues | **Coût moyen pondéré**, recalculé à chaque entrée, figé sur la commande à l'expédition |
| Emballage | Coût fixe par colis (réglage), figé à l'expédition |
| Pièce retournée | Le contrôle décide : les revendables reviennent en vente automatiquement, l'abîmée sort en perte |
| Frais de livraison facturés | Un montant unique en réglage, modifiable sur chaque commande |
| Cliente | Pseudo Instagram + reconnaissance par téléphone, avec adresse préremplie et historique |
| Code | Branche `feat/back-office` + pull request sur `Achrafsila/sparklejewelry` |
| Interface | Vite + React + TypeScript (choix de Claude ; la demande laissait l'architecture ouverte) |

## 4. Approches envisagées

1. **Vite + React + TypeScript (site statique) + Supabase, avec les règles métier en fonctions Postgres.** **← retenue.** Chaque opération qui touche le stock ou l'argent s'exécute en une seule transaction dans la base, avec verrouillage des lignes et protection contre les doublons. Vercel ne sert que des fichiers. La future boutique appellera les mêmes fonctions.
2. **Next.js sur Vercel.** Ajoute un serveur et des sessions côté serveur. Ce serait utile si la boutique vivait dans la même application, mais elle est hors périmètre : complexité sans gain aujourd'hui.
3. **Fichier HTML unique + Supabase par CDN.** C'est le plus proche du prototype, mais il devient ingérable et difficile à tester à cette taille (six rubriques, une vingtaine de composants, états de chargement et d'erreur).

## 5. Architecture

```
Navigateur (React, SWR)
   │  supabase-js : lectures (RLS admin) + appels RPC
   ▼
Supabase
   ├─ Postgres : tables, vues de lecture, fonctions métier (SECURITY DEFINER + is_admin())
   ├─ Auth     : e-mail + mot de passe, inscriptions désactivées, table admins
   └─ Storage  : bucket « photos » (lecture publique, écriture admin)
Vercel : build statique, réécriture SPA vers index.html
```

- **Écritures sensibles uniquement par fonctions.** C'est le cas pour les arrivages, les commandes et leurs changements d'état, les retours, les versements et les corrections de stock. Les colonnes de quantité et de coût ne sont jamais modifiables directement (`revoke update` sur ces colonnes). Les métadonnées simples (nom d'offre, canaux, réglages, budget pub, fiche cliente) passent par des écritures de table protégées par RLS.
- **Idempotence générique.** Chaque fonction qui modifie quelque chose reçoit un `p_request_id uuid`, créé par le client à la première tentative et réutilisé pour les nouvelles tentatives du même envoi. La table `request_log(request_id, fn, result, created_at)` renvoie le résultat déjà calculé si l'identifiant est connu. S'y ajoutent des contrôles d'état : on ne confirme pas une commande déjà confirmée et on ne réceptionne pas un retour déjà reçu.
- **Concurrence.** Avant toute modification, les références concernées sont verrouillées dans un ordre fixe (`order by id for update`), ce qui évite les interblocages. La réservation est un `update … where physical - reserved >= besoin` dans la même transaction. La première confirmation validée prend la dernière pièce, la seconde reçoit l'erreur de manque.
- **Lectures.** Ce sont des vues SQL (`v_stock`, `v_offers`, `v_orders`, `v_payouts`, `v_dashboard_*`) lues avec SWR (cache et dédoublonnage), revalidées après chaque action.
- **Préparation de la boutique.** La vue `shop_catalog` expose uniquement les offres actives sur le Site, avec leur disponibilité. La fonction `place_site_order(p_request_id, p_payload)` crée et confirme la commande d'un seul coup, recalcule les prix côté serveur et conserve `channel = 'site'`. Elle est réservée au rôle `service_role` (le serveur de la future boutique). Le guide `docs/boutique.md` décrit comment la brancher.

## 6. Modèle de données

Montants en **centimes (entiers)**, dates en `timestamptz`, quantités en entiers.

- `settings` (ligne unique) : `low_stock_threshold` (5), `packaging_cost_cents`, `default_shipping_fee_cents`, `carriers text[]`.
- `products` (modèle) : `id`, `name` (unique, insensible à la casse et aux accents).
- `variants` (référence vendable) : `id`, `product_id`, `sku` (unique, insensible à la casse), `label` (variante, facultative), `photo_path`, `physical_qty`, `reserved_qty`, `available_qty` (colonne générée = physique − réservé), `avg_cost_cents numeric(12,4)`, `archived`. Contraintes : `0 <= reserved_qty <= physical_qty`. Un modèle sans variante nommée a une seule référence dont `label` est vide.
- `receipts` (arrivage) : `id`, `supplier`, `received_on`, `created_at` ; `receipt_lines` : `variant_id`, `qty`, `unit_cost_cents`. C'est l'historique des coûts par arrivage.
- `stock_movements` (journal) : `variant_id`, `kind` (`arrivage`, `reservation`, `liberation`, `expedition`, `retour_revendable`, `retour_perte`, `correction`, `import`), `physical_delta`, `reserved_delta`, `unit_cost_cents`, `order_id`, `receipt_id`, `note`, `created_at`. Invariant testé : la somme des mouvements est égale aux quantités de `variants`.
- `offers` : `id`, `name`, `kind` (`unit`, `fixed_trio`, `custom_trio`), `price_cents`, `photo_path`, `on_instagram`, `on_site`, `allow_repeat` (trio à composer), `archived`.
- `offer_items` : `offer_id`, `variant_id`, `qty`, `price_cents` (facultatif).
  - À l'unité : une ligne par variante proposée. `price_cents` est vide pour le prix commun, ou renseigné pour un prix distinct.
  - Trio fixe : la composition exacte, avec la somme des `qty` égale à 3. Exemple : bronze × 2 + argent × 1.
  - Trio à composer : les références éligibles, avec `qty` égal à 1.
- `customers` : `id`, `name`, `phone` (normalisé `+2126…`, unique), `instagram`, `city`, `address`.
- `orders` :
  - identification : `id`, `number` (`SPK-0001`, séquence), `channel` (`instagram`, `site`) ;
  - statut : `status` (`brouillon`, `confirmee`, `preparee`, `en_livraison`, `livree`, `payee`, `retour_attendu`, `retour_recu`, `annulee`) ;
  - cliente : `customer_id` et une copie des coordonnées (nom, téléphone, pseudo, ville, adresse) ;
  - paiement et livraison : `payment_method` (`cod`, plus `prepaid` réservé au site), `shipping_fee_cents` (facturé), `carrier`, `tracking` ;
  - coûts : `transport_cost_cents`, `packaging_cost_cents` (figé), `return_fee_cents` ;
  - dates : `confirmed_at`, `prepared_at`, `shipped_at`, `delivered_at`, `paid_at`, `return_reported_at`, `return_received_at`, `cancelled_at`.
- `order_lines` (composition commerciale) : `order_id`, `offer_id`, copies de `offer_name`, `offer_kind` et `unit_price_cents`, `qty`. Une ligne de trio à composer a toujours `qty = 1`. Pour deux trios différents, on ajoute deux lignes.
- `order_items` (pièces) : `line_id`, `variant_id`, copies de `sku` et `label`, `qty` (total pour la ligne), `picked bool`, `unit_cost_cents` (figé à l'expédition), `returned_resalable`, `returned_damaged`.
- `order_events` : historique des statuts (de, vers, date, note).
- `payouts` (versement transporteur) : `id`, `carrier`, `received_on`, `reference`, `amount_received_cents`.
- `payout_orders` : `payout_id`, `order_id` (unique : une commande appartient à un seul versement), `expected_cents`, `received_cents`.
- `ad_spend` : `month` (premier jour du mois), `amount_cents`, `note`.
- `admins` : `user_id`. `is_admin()` vérifie `auth.uid()` dans cette table.

**Figer l'historique.** Le nom, le prix et la composition d'une offre sont copiés sur la commande quand la ligne est ajoutée au panier. Le prix retenu est celui qui a été vu et convenu en DM. Ces copies deviennent définitives à la confirmation. Modifier ou archiver une offre ne touche jamais une commande existante.

## 7. Règles métier (fonctions Postgres)

| Fonction | Effet (une transaction) | Garde-fous |
|---|---|---|
| `validate_receipt(req, supplier, date, lines)` | Crée les modèles et références nouveaux, augmente le physique, recalcule le coût moyen, enregistre l'arrivage et les mouvements | Référence unique ; quantité ≥ 1 ; coût ≥ 0 ; idempotent |
| `save_order_draft(req, order)` | Crée ou met à jour un brouillon. Les prix et compositions sont recalculés depuis les offres ; la fiche cliente est créée ou mise à jour par téléphone. | Brouillon uniquement ; **aucune réservation** |
| `confirm_order(req, order_id)` | Additionne les besoins par référence sur toute la commande (unités + composants des trios), verrouille, vérifie, réserve tout ou rien | Manque : erreur avec `[{sku, besoin, disponible}]` ; déjà confirmée : renvoie l'état sans rien réserver |
| `place_site_order(req, payload)` | Comme `save_order_draft` + `confirm_order`, avec `channel = 'site'` | `service_role` uniquement ; idempotent par `req` |
| `set_item_picked(item_id, picked)` / `mark_prepared(req, order_id)` | Cochage des pièces ; statut `preparee` | Toutes les pièces cochées |
| `ship_order(req, order_id, carrier, tracking, transport)` | **Physique − besoin et réservé − besoin dans la même mise à jour** : le disponible ne baisse pas une seconde fois. Fige le coût moyen par pièce et l'emballage. | Statut `preparee` ; transport obligatoire |
| `cancel_order(req, order_id)` | Libère la réservation (`liberation`) | Avant expédition seulement |
| `mark_delivered(req, order_id)` / `report_return(req, order_id, return_fee?)` | `livree` ou `retour_attendu` | Depuis `en_livraison` uniquement (colis refusé ou renvoyé par le transporteur) ; frais de retour saisissables dès le signalement |
| `receive_return(req, order_id, items, return_fee)` | Remet en stock les pièces revendables au coût figé (recalcul du coût moyen) ; les abîmées passent en `retour_perte` à leur coût | Revendables + abîmées = expédiées ; **un seul passage** (`retour_recu` final) |
| `record_payout(req, carrier, date, reference, amount, orders)` | Crée le versement, rattache les commandes (livrées : `payee` ; retours : frais réglés), calcule l'écart | Commande déjà rattachée : refusée |
| `adjust_stock(req, variant_id, delta, reason)` | Correction manuelle avec motif obligatoire | Physique ≥ réservé après correction |
| `import_prototype(req, json)` | Importe références, quantités, arrivages et offres du prototype | Aperçu des comptes avant validation ; refusé si une référence existe déjà |

**Montant attendu d'un versement**, par commande :
- livrée : bijoux + frais facturés − transport réel ;
- retournée : −(transport réel + frais de retour).

L'écart (reçu − attendu) reste affiché sur le versement, sur chaque commande concernée et dans Pilotage. *Choix de Claude :* une commande rattachée à un versement passe « Payée », même avec un écart. L'écart reste signalé jusqu'à ce qu'il soit annoté.

**Alerte de stock bas.** Les fonctions renvoient les références dont le disponible passe de plus du seuil à au plus le seuil (*choix de Claude :* « au plus 5 », comme dans le prototype). Le passage de 6 à 4 déclenche l'alerte. L'interface l'affiche près de l'action, avec les offres concernées. Aucune offre n'est mise en pause automatiquement.

**Coût moyen pondéré.** À une entrée de `q` pièces au coût `c` : `moyen = (physique × moyen + q × c) / (physique + q)`. Si le physique est à 0 : `moyen = c`. Les sorties ne changent pas le coût moyen.

**Référence proposée.** Elle est formée du modèle et de la variante, sans accents ni espaces, en majuscules (`BAGUE-LUNA-OR`), avec un suffixe `-2` si elle est déjà prise. Elle reste modifiable.

**Saisie des montants.** `15,50`, `15.50` et `15` sont acceptés ; `15,5,0`, les négatifs et plus de deux décimales sont refusés avec un message sous le champ. La valeur est enregistrée en centimes (1550).

## 8. Interface

### 8.1 Direction artistique

Principe : **un écrin, pas une vitrine.** Le verre ne sert qu'à ce qui flotte (navigation, barre d'actions, panneaux). Le travail se fait sur des surfaces opaques. Les photos des bijoux sont les seuls éléments vraiment colorés.

| Jeton | Valeur | Usage |
|---|---|---|
| Ivoire | `#F5F0E6` | Fond de page |
| Nacre | `#FFFDF8` | Surfaces de travail opaques, champs, tableaux |
| Encre charbon | `#22211E` | Texte, bouton principal |
| Pierre | `#6B665D` (texte secondaire, contraste ≥ 4,5:1) · `#D9D3C7` (bordures) | |
| Champagne | `#C9B48A` (filets, indicateur actif) · `#7A6334` (anneau de focus, liens) | Accent discret |
| États | succès `#2F6B4F`, attention `#8A5A12`, erreur `#A3302A`, info `#2F5A7A`, neutre `#5E5A52`, chacun sur un fond pâle | Toujours accompagnés d'un libellé |

- **Typographie.** Instrument Sans pour l'interface : 16 px dans les champs, ce qui évite le zoom iOS. Chiffres tabulaires (`font-variant-numeric: tabular-nums`) pour les quantités et les montants. Instrument Serif pour le mot-symbole « Sparkle » et les titres de page uniquement. Les polices sont auto-hébergées (`@fontsource`). *À vérifier au build :* la présence de `tnum` dans Instrument Sans ; à défaut, Inter pour les cellules numériques.
- **Liquid Glass.** `background: rgb(255 253 248 / .72)`, `backdrop-filter: blur(16px) saturate(140%)`, bordure de 1 px claire avec un liseré champagne en haut, ombre douce. Repli opaque si `backdrop-filter` n'est pas pris en charge ou si `prefers-reduced-transparency: reduce`. Bordures renforcées si `prefers-contrast: more`. Le verre ne s'applique jamais aux champs, tableaux ou panneaux de travail.
- **Élément signature.** L'« écrin » : les photos sont des vignettes rondes cerclées de pierre, et l'anneau devient champagne quand la pièce est sélectionnée. Dans le sélecteur de trio, trois écrins vides se remplissent avec les photos choisies (0/3 → 3/3). Le reste de l'interface reste sobre. Une photo manquante affiche un écrin vide neutre avec une icône de bague au trait.
- **À éviter.** Majuscules espacées sur les libellés, chaînes de méta-données séparées par des points médians (le prototype en abuse), flèches dans les boutons, cartes identiques partout, chiffres géants.
- **Formulaires.**
  - Couleurs explicites : fond, texte, `caret-color`, `-webkit-text-fill-color`, placeholder (opacité 1), options de `select`.
  - Surcharge de l'autocomplétion (`:-webkit-autofill` : fond nacre via `box-shadow` intérieur, texte charbon).
  - `color-scheme: light` sur la racine et les contrôles.
- **Mouvement.** Seulement en réponse à une action (ouverture d'un panneau, ligne ajoutée qui s'éclaire brièvement), 150 à 250 ms. Supprimé si `prefers-reduced-motion`.
- **Icônes.** Lucide (SVG), avec libellé ou `aria-label`.

### 8.2 Navigation

- **Ordinateur (≥ 1024 px).** Barre latérale en verre : Stock, Offres, Commandes, Préparation, Suivi, Pilotage ; Réglages et la déconnexion en bas ; le bouton « Nouvelle commande Instagram » sous le logo. Chaque écran a le même en-tête, à la manière de Linear : titre, compteur, recherche et filtres, action principale à droite.
- **Tablette (768 à 1023 px).** Barre latérale réduite aux icônes avec libellés en infobulle et focus clavier.
- **Mobile (< 768 px).** Barre inférieure en verre avec Stock, Commandes, Suivi, un bouton central « + Commande » et « Plus » (Offres, Préparation, Pilotage, Réglages). Une barre d'actions persistante en verre, au-dessus, porte l'action principale de l'écran à portée de pouce. Elle respecte la zone de sécurité (`env(safe-area-inset-bottom)`).
- **Recherche globale**, à la manière de Stripe : touche « / » sur ordinateur, icône sur mobile. Elle cherche par numéro de commande, téléphone, @pseudo, nom, numéro de suivi, référence de bijou et référence de versement, avec des résultats groupés qui ouvrent directement la fiche.
- **Fiches** dans un panneau latéral (plein écran sur mobile) : référence (stock, coûts par arrivage, mouvements, offres), commande (chronologie, composition, pièces, versement, écart), versement (commandes, attendu, reçu, écart). Chaque fiche a son URL, ce qui permet de reprendre et de partager un lien.

```
Ordinateur — Stock
┌────────────┬──────────────────────────────────────────────────────┐
│ Sparkle    │ Stock  42 références      [Rechercher…] [Stock bas]  │
│ + Commande │                              [ Nouvel arrivage ]     │
│            │ ⚠ Stock bas : Bague Luna or, 4 disponibles. Offres : │
│ Stock      │   Trio Luna, Luna à l'unité                          │
│ Offres     │ ┌──┬─────────────┬────────┬──────────┬────┬────┬────┐│
│ Commandes  │ │◯ │ Modèle      │Variante│Référence │Phys│Rés.│Disp││
│ Préparation│ │◯ │ Bague Luna  │ Or     │BAGUE-LU… │  6 │  2 │  4 ││
│ Suivi      │ └──┴─────────────┴────────┴──────────┴────┴────┴────┘│
│ Pilotage   │                                                      │
└────────────┴──────────────────────────────────────────────────────┘

Mobile — Nouvelle commande (étape 1/3)
┌───────────────────────────┐
│ Nouvelle commande         │
│ Panier · Cliente · Récap  │  ← étapes : vraie séquence
│ [Rechercher une offre…]   │
│ ◯ Trio Luna      240 MAD  │
│ ◯ Luna à l'unité  95 MAD  │
│ ─ Trio à composer ─────── │
│  ( ◯ )( ◯ )( · )   2/3    │
├───────────────────────────┤
│ 2 articles · 335 MAD      │  ← barre d'actions (verre)
│ [   Continuer   ]         │
├───────────────────────────┤
│ Stock  Cmdes  (+)  Suivi ⋯│  ← barre inférieure (verre)
└───────────────────────────┘
```

### 8.3 Écrans

- **Stock.**
  - Tableau sur ordinateur, cartes sur mobile : photo, modèle, variante, référence, physique, réservé, disponible (avec badge « Stock bas » ou « Rupture »).
  - Filtres : recherche, stock bas, rupture, archivées.
  - Bandeau d'alerte avec les offres concernées.
  - Action principale : **Nouvel arrivage**.
- **Nouvel arrivage.**
  - Deux espaces bien séparés, côte à côte sur ordinateur et empilés sur mobile.
  - **Nouveau modèle**, champs dans cet ordre :
    1. Référence (proposée, modifiable, unicité vérifiée en direct) ;
    2. Modèle (suggestions des noms existants : choisir un nom existant crée une variante de ce modèle) ;
    3. Variante (facultative) ;
    4. Quantité reçue ;
    5. Coût d'achat unitaire ;
    6. Photo, avec « Choisir une photo » et « Prendre une photo » (`capture="environment"`, affiché seulement sur appareil tactile).
  - **Modèle existant** : recherche (photo, modèle, variante, référence visibles), quantité, nouveau coût unitaire.
  - Le **récapitulatif** commun contient le fournisseur et la date (saisis une fois), puis les lignes modifiables (quantité, coût) ou retirables, et le total. **Valider l'arrivage** est dans la barre d'actions.
  - Le brouillon d'arrivage est gardé sur l'appareil (stockage local versionné) : il survit à une fermeture de l'onglet.
  - La photo est redimensionnée côté navigateur (1600 px max., JPEG) puis envoyée au moment de « Ajouter à l'arrivage », avec une barre de progression et le bouton désactivé. Une photo illisible affiche une erreur sous le champ photo, et la saisie est conservée.
- **Offres.**
  - Liste : nom, format, prix, interrupteurs Instagram et Site (libellés « Active » ou « En pause »), disponibilité (unités, trios réalisables, ou nombre de pièces éligibles disponibles).
  - Création et modification dans un panneau selon le format :
    - à l'unité : une ou plusieurs variantes, prix commun ou prix par variante ;
    - trio fixe : sélection par écrins avec compteur. Affiche la somme des prix à l'unité des mêmes pièces et prévient, sans bloquer, si le trio n'est pas moins cher. Affiche aussi le nombre de trios réalisables.
    - trio à composer : grille de références éligibles avec photo et disponibilité, option « Autoriser la même pièce plusieurs fois », prix fixe affiché.
- **Commandes.**
  - Liste avec filtres (statut, canal, période), recherche, et action principale **Nouvelle commande Instagram**.
  - Parcours en trois étapes sur mobile, sections sur une seule page sur ordinateur :
    1. **Panier** : offres et quantités. Une offre à l'unité avec plusieurs variantes demande la variante. Un trio à composer ouvre le sélecteur par écrins (photos, disponibilité, 0/3 à 3/3), et une combinaison indisponible ou non autorisée est expliquée sous le sélecteur.
    2. **Cliente** : saisir le téléphone reconnaît une cliente connue (« Cliente connue : 3 commandes, 1 retour ») et propose de préremplir. Puis @pseudo, nom, ville, adresse, frais de livraison (préremplis avec le réglage).
    3. **Récapitulatif** : actions **Enregistrer en brouillon** ou **Confirmer**. Un manque affiche, sous le bouton, chaque référence avec son besoin et son disponible ; la saisie reste intacte.
  - Le panier en cours est aussi gardé sur l'appareil.
- **Préparation.**
  - « À préparer » : commandes confirmées et préparées.
  - Chaque carte montre la composition commerciale, puis les pièces à sortir **regroupées par référence et quantité**, avec la photo et une case à cocher enregistrée en base (on peut reprendre sur un autre appareil).
  - **Marquer préparée**, puis le formulaire d'expédition : transporteur (liste des réglages), numéro de suivi (facultatif), coût réel du transport. Action **Expédier**.
  - **Annuler la commande** est en action secondaire, avec confirmation.
- **Suivi.**
  - Quatre segments toujours visibles avec leurs compteurs :
    - **Livraison en cours** ;
    - **Livrée**, avec le montant restant à recevoir ;
    - **Payée** ;
    - **Retour**, avec les sous-états « attendu » et « reçu et contrôlé ».
  - Actions : Marquer livrée, Signaler un retour, Réceptionner le retour. Dans ce dernier formulaire, chaque pièce est déjà comptée comme revendable : on indique les abîmées, puis les frais de retour.
  - Action principale **Enregistrer un versement** :
    1. choisir le transporteur, la date, la référence et le montant reçu ;
    2. cocher les commandes livrées et retournées de ce transporteur, avec leur montant attendu ;
    3. le reçu peut être ajusté commande par commande ;
    4. le total attendu, le reçu et l'écart s'affichent en direct.
  - Liste des versements, consultable par référence.
- **Pilotage.**
  - Filtres : période (ce mois, mois précédent, 7 jours, personnalisée) et canal (tous, Instagram, Site).
  - Indicateurs en lignes sobres : commandes livrées, montants encaissés, versements attendus, panier moyen (bijoux seuls), retours (nombre, taux, frais), écarts de versement.
  - Liste des références en stock bas.
  - Le bloc **Marge** affiche d'abord les **coûts manquants** : emballage non réglé, budget pub non saisi pour un mois de la période, références sans coût connu (import). Le détail suit, nommé « marge estimée » :
    - (+) prix des bijoux et frais facturés ;
    - (−) coût des pièces, transport réel par colis, emballage, frais de retour, pièces perdues ;
    - (−) budget publicitaire de la période ;
    - (=) marge estimée.
  - Le budget pub se saisit par mois, dans ce même écran.
- **Réglages.** Seuil d'alerte, coût d'emballage par colis, frais de livraison par défaut, transporteurs, export de toutes les données (JSON), import d'un export du prototype, déconnexion.
- **Connexion.** E-mail + mot de passe, « Mot de passe oublié ». Le compte est créé dans Supabase par la gérante, et les inscriptions sont désactivées.

### 8.4 Règles transverses

- **Retour au plus près de l'action.** Chaque formulaire a une zone d'état (`aria-live`) sous son bouton. Une erreur de champ s'affiche sous ce champ, et la saisie est conservée. Un ajout réussi fait apparaître la ligne tout de suite, brièvement mise en évidence.
- **États.** Squelettes pendant le chargement, état vide qui invite à l'action (« Aucune référence. Commencez par un arrivage. »), erreur avec **Réessayer**. Pendant un envoi, le bouton affiche la progression et est désactivé, et l'identifiant `request_id` protège côté serveur.
- **Accessibilité.**
  - Navigation complète au clavier, avec un lien d'évitement.
  - Focus visible : anneau champagne foncé de 2 px avec décalage.
  - Panneaux et dialogues : focus piégé et touche Échap.
  - Cibles tactiles d'au moins 44 px.
  - Contrastes AA vérifiés.
  - `lang="fr"`, libellés visibles sur tous les champs.
- **Format.** Français, montants `1 234,50 MAD` (`Intl`, `fr-MA`), dates `24 nov. 2026`.
- **Pas de débordement horizontal** de la page à 390 px. Les tableaux larges passent en cartes, sans défilement latéral de page.

## 9. Structure du code

```
index.html, vite.config.ts, vercel.json, package.json
src/
  app/            routes, layout (barre latérale, barre inférieure, barre d'actions)
  features/       stock/, arrivals/, offers/, orders/, preparation/, tracking/, payouts/, dashboard/, settings/, search/
  ui/             Button, Field, MoneyField, Table/CardList, StatusBadge, Sheet, Notice, PhotoSlot (écrin), Skeleton, EmptyState
  lib/            supabase.ts, money.ts (analyse « 15,50 »), phone.ts, sku.ts, photo.ts (redimensionnement + envoi avec progression), drafts.ts (stockage local versionné)
  styles/         tokens.css, base.css, glass.css
supabase/
  migrations/     0001_schema.sql, 0002_functions.sql, 0003_views.sql, 0004_rls.sql, 0005_storage.sql
  seed.sql        réglages initiaux (pas de données fictives en production)
tests/
  db/             scénarios SQL via Vitest + pg (dont confirmations simultanées sur deux connexions)
  unit/           money, phone, sku, besoins par référence
  e2e/            Playwright (Chromium + WebKit ; 390 / 768 / 1280 px ; mode sombre émulé)
dev/              pile locale : Postgres, PostgREST, bouchons Auth et Storage (développement et tests uniquement)
legacy/prototype.html   ancien prototype conservé, avec un bouton « Exporter (JSON) » ajouté
docs/             boutique.md, mise-en-service.md (Supabase, Vercel)
```

Vercel n'exécute pas de code serveur ici : il sert `dist/` avec une réécriture SPA. Les clés publiques (URL et clé `anon`) passent par `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` ; aucun secret n'est envoyé au navigateur.

## 10. Vérification

**Ce que je peux vérifier ici, sans Supabase en ligne.** Une pile locale, uniquement sur `localhost` :
- le Postgres 17 déjà installé (instance dédiée dans `.local/`, ignorée par git) ;
- **PostgREST** (à installer via Homebrew, ~20 Mo) ;
- de petits bouchons « Auth » et « Storage » qui imitent les routes Supabase utilisées, avec un compte de test défini dans `dev/seed`.

L'interface réelle tourne ainsi contre les vraies fonctions SQL et la vraie API REST.

- **Base (Vitest + pg).** Les huit scénarios de la demande au niveau SQL :
  - quantités et coûts ;
  - `15,50` enregistré à 1550 ;
  - trio fixe + unité, soit 2 bronzes réservés ;
  - passage de 6 à 4 qui déclenche l'alerte ;
  - trio à composer non disponible ;
  - brouillon sans réservation ;
  - **deux confirmations simultanées** sur deux connexions : une seule réussit, et le stock n'est jamais négatif ;
  - rejeu sans double réservation ;
  - expédition sans double baisse du disponible ;
  - retour partiel avec une pièce abîmée ;
  - second passage de retour refusé ;
  - versement avec écart.

  L'invariant « mouvements = quantités » est vérifié après chaque scénario.
- **Parcours réels (Playwright).**
  - Les scénarios 1 à 8 sont joués dans l'interface, sur Chromium et **WebKit** (moteur de Safari), à 390, 768 et 1280 px.
  - Contrôles : saisie en **mode sombre émulé**, clavier seul, absence de débordement horizontal, états vide, chargement et erreur, reprise après rechargement de la page.
  - Les captures d'écran sont relues.
- **Revues.**
  - `web-design-guidelines` (Vercel) sur les composants d'interface ;
  - `vercel-react-best-practices` sur le code React ;
  - liste de contrôle avant livraison d'UI UX Pro Max ;
  - contrastes calculés ;
  - `npm run build`, `tsc` et le linter sans erreur.

**Ce qui restera à vérifier**, et pourquoi :
- **Safari sur un iPhone réel en mode sombre**, y compris l'autocomplétion : Xcode n'est pas installé ici, donc pas de simulateur iOS. WebKit + mode sombre émulé est l'approximation la plus proche.
- **« Prendre une photo »** avec l'appareil photo réel.
- **La connexion à Supabase et Vercel en ligne** : voir le prérequis ci-dessous.

**Prérequis pour la mise en ligne** (documentés dans `docs/mise-en-service.md`) :
1. Créer le projet Supabase (région Europe) et désactiver les inscriptions.
2. Appliquer les migrations : coller les fichiers SQL dans l'éditeur SQL, ou fournir l'URL de connexion de la base dans un fichier `.env.local` non versionné.
3. Créer le compte administrateur dans Authentication et l'ajouter à la table `admins`.
4. Renseigner `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.
5. Créer le projet Vercel. Claude le fait avec la CLI déjà connectée, **après accord explicite**.

## 11. Découpage proposé

1. Socle : dépôt, pile locale, schéma, fonctions métier, tests SQL des scénarios.
2. Coque de l'application : direction artistique, navigation, connexion, composants.
3. Stock et Nouvel arrivage.
4. Offres.
5. Commandes (Instagram) et fiche cliente.
6. Préparation, Suivi, retours, versements.
7. Pilotage, Réglages, import et export, recherche globale.
8. Vérification de bout en bout, revues, pull request.

## 12. Choix laissés à l'implémentation

Une relecture « regard de développeur » a soulevé quelques cas limites. Ils sont tranchés ici :

- **Interrupteurs de canal.** Ils ne concernent que les nouveaux paniers. Un brouillon existant reste confirmable si le stock le permet.
- **Commande confirmée.** Elle n'est pas modifiable. Pour la changer, on l'annule (ce qui libère les pièces) puis on la recrée. Un brouillon, lui, peut être supprimé.
- **Retour.** Il se signale depuis « Livraison en cours » (colis refusé ou renvoyé). Le retour d'un colis déjà livré et payé, qui impliquerait un remboursement, est hors périmètre.
- **Frais de retour.** Ils se saisissent au signalement ou à la réception. Si un versement arrive avant, l'attendu utilise la valeur connue et l'écart le révélera.
- **Comparaison du trio fixe.** Elle utilise, pour chaque pièce, le prix à l'unité actif le plus bas. Sans offre à l'unité, elle affiche « pas de prix à l'unité ».
- **Nom déjà utilisé.** Dans Nouveau modèle, saisir un modèle existant avec une variante existante est refusé, avec un renvoi vers « Modèle existant ».
- **Photo d'une référence.** Elle peut être changée depuis sa fiche.
- **Périodes du Pilotage.** Les ventes et leurs coûts sont comptés à la date de livraison, les encaissements à la date du versement, les retours à la date de signalement.

Ces choix sont faits par Claude et signalés pour relecture :

- l'alerte se déclenche à **au plus 5** disponibles ;
- « Payée » même avec un écart, l'écart restant affiché ;
- le prix est figé quand l'offre entre dans le panier ;
- un trio à composer a toujours une quantité de 1 par ligne ;
- les commandes sont numérotées `SPK-0001` ;
- la référence est proposée à partir du modèle et de la variante ;
- l'interface reste claire, sans thème sombre ;
- la correction manuelle de stock avec motif est ajoutée (sans elle, une erreur d'arrivage déjà validé ne se corrige pas) ;
- les commandes du prototype ne sont pas importées (données de test).

Sont aussi laissés à l'implémentation : SWR pour les lectures, CSS natif avec jetons (pas de Tailwind), Lucide pour les icônes, et le découpage précis des composants.
