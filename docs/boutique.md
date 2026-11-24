# Brancher la future boutique sur le même stock

La boutique publique n’est pas construite. Ce qui suit est déjà en place dans la base pour qu’elle partage **le même catalogue, le même stock et les mêmes règles de réservation** que le back-office.

## Principe

- La boutique ne parle **jamais** à la base depuis le navigateur du client.
- Son serveur (fonction serverless, route API…) utilise la clé `service_role` de Supabase, gardée secrète côté serveur.
- Il lit le catalogue dans la vue `shop_catalog` et passe commande avec la fonction `place_site_order`.

## Lire le catalogue : `shop_catalog`

Uniquement les offres actives sur le canal **Site** et non archivées :

| Colonne | Contenu |
|---|---|
| `id`, `name`, `kind`, `price_cents`, `photo_path`, `allow_repeat` | l’offre (`kind` : `unit`, `fixed_trio`, `custom_trio`) |
| `items` | pièces : `variant_id`, `sku`, `name`, `photo_path`, `qty`, `price_cents`, `available_qty` |
| `sellable` | unités, trios réalisables ou pièces éligibles disponibles |

Les disponibilités sont **plafonnées à 10** : la boutique sait si c’est disponible, sans exposer le stock exact.
Les photos sont lisibles à `https://<projet>.supabase.co/storage/v1/object/public/photos/<photo_path>`.

## Passer commande : `place_site_order`

```ts
const { data, error } = await supabase.rpc('place_site_order', {
  p_request_id: requestId, // un UUID par tentative de paiement/validation, réutilisé si on réessaie
  p_order: {
    customer: { name, phone, instagram: null, city, address },
    shipping_fee_cents: 3500,
    payment_method: 'cod', // ou 'prepaid' si payé en ligne à l'avance
    lines: [
      { offer_id, qty: 1 }, // unité ou trio fixe
      { offer_id, qty: 1, variant_id }, // offre à l'unité avec plusieurs variantes
      { offer_id, qty: 1, picks: [idA, idB, idC] }, // trio à composer
    ],
  },
});
```

En **une seule transaction**, la fonction :

1. vérifie que chaque offre est active sur le Site ;
2. **recalcule les prix** à partir des offres (un prix envoyé par le navigateur est ignoré) ;
3. crée ou met à jour la fiche cliente (téléphone marocain normalisé) ;
4. additionne les besoins par référence, verrouille les références et **réserve tout ou rien** ;
5. enregistre la commande avec le canal `site`. Elle apparaît dans le back-office (Commandes, Préparation).

### Garanties

- **Dernière pièce** : deux confirmations simultanées ne peuvent pas la vendre deux fois. La première transaction validée la réserve, la seconde reçoit `STOCK_INSUFFISANT`.
- **Nouvel envoi** : rappeler avec le même `p_request_id` renvoie le résultat déjà enregistré, sans nouvelle commande ni double réservation.

### Erreurs à traiter

Les erreurs arrivent dans `error.message`, avec un détail JSON dans `error.details` :

| Code | Sens |
|---|---|
| `STOCK_INSUFFISANT` | `details` : `[{ sku, name, need, available }]` pour chaque référence en manque |
| `OFFRE_INVALIDE` | offre inconnue, archivée, pas sur le Site, ou variante manquante |
| `TRIO_INVALIDE` | trio à composer : `reason` vaut `count`, `non_eligible` ou `repeat` |
| `VALEUR_INVALIDE` | `field` : `customer_name`, `customer_phone`, `customer_city`, `customer_address`, `qty`… |

## Ce qui reste à faire côté boutique

- les pages et le panier publics ;
- le paiement en ligne (`payment_method: 'prepaid'`) ;
- les e-mails ou messages de confirmation ;
- éventuellement, une fonction d’annulation côté client (aujourd’hui, l’annulation se fait dans le back-office).
