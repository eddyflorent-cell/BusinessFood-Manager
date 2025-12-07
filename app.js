/* ============================================================
    BusinessFood Manager v4 PRO
   Auteur : Takougang Eddy (Fotsi Global Services)
   Usage : Gestion ingrédients, recettes, produits finis, ventes, stock
   © 2025 – Tous droits réservés
=========================================================== */

/* ===============================
     DATABASE (MODE C — PRO)
   =============================== */

const DB = {
    ingredients: [],
    packs: [],
    vendors: [],
    expenses: [],

    sales: [], 
    // {id, date, vendorId, unitPrice, units, packs:{packId:qte}, lieu, meteo, start, end, notes}

    days: [],   
    // {id, date, lieu, meteo, start, end, ventes:[sales], notes}

    settings: {
        currency: "FCFA",
        lastUnitPrice: 50
    }
};

/* Load / Save */
function saveDB() {
    localStorage.setItem("WE_GAUFRES_DB", JSON.stringify(DB));
}

function loadDB() {
    const raw = localStorage.getItem("WE_GAUFRES_DB");
    if (raw) {
        const parsed = JSON.parse(raw);
        Object.assign(DB, parsed);
    }
}

loadDB();

/* ======================== STATE ======================== */

let state = {
    vendeurs: JSON.parse(localStorage.getItem("vendeurs") || "[]"),
    packs: JSON.parse(localStorage.getItem("packs") || "[]"),
    ventesJour: JSON.parse(localStorage.getItem("ventesJour") || "[]"),
    depensesJour: JSON.parse(localStorage.getItem("depensesJour") || "[]"),
    historique: JSON.parse(localStorage.getItem("historique") || "[]"),
    ingredients: JSON.parse(localStorage.getItem("ingredients") || "[]")
};
// Stock global de gaufres prêtes (production - ventes)
let stockGaufres = parseInt(localStorage.getItem("stockGaufres") || "0", 10) || 0;

function saveStockGaufres() {
    localStorage.setItem("stockGaufres", String(stockGaufres));
}

// Packs ajoutés à la vente en cours (avant d'enregistrer)
let venteCourantePacks = [];

/* Sauvegarde globale */
function saveState() {
    localStorage.setItem("vendeurs", JSON.stringify(state.vendeurs));
    localStorage.setItem("packs", JSON.stringify(state.packs));
    localStorage.setItem("ventesJour", JSON.stringify(state.ventesJour));
    localStorage.setItem("depensesJour", JSON.stringify(state.depensesJour));
    localStorage.setItem("historique", JSON.stringify(state.historique));
    localStorage.setItem("ingredients", JSON.stringify(state.ingredients));
}

/* =====================================================
      BLOC 2 – RECETTES PRO : MOTEUR COMPLET
   ===================================================== */

/* --- Récupération des données --- */
let recettes = JSON.parse(localStorage.getItem("recettes")) || [];

// 🔹 Buffer partagé Ingrédients ↔ Recettes
let recetteBuffer = JSON.parse(localStorage.getItem("recetteBuffer") || "null") || {
    nom: "",
    nbGaufres: 0,
    ingredients: []
};
// Index de la recette en cours d'édition (null = création)
let recetteEditIndex = null;

// Sauvegarde du buffer partagé
function saveRecetteBuffer() {
    localStorage.setItem("recetteBuffer", JSON.stringify(recetteBuffer));
}


/* ---------- OUTILS DE STOCKAGE ---------- */

function saveRecettes() {
    localStorage.setItem("recettes", JSON.stringify(recettes));
}

/* =====================================================
      CHARGER LES INGREDIENTS POUR LA RECETTE
   ===================================================== */

function loadIngredientSelectForRecipe() {
    const sel = document.getElementById("rec-ingredient-select");
    if (!sel) return;

    sel.innerHTML = `<option value="">-- Choisir un ingrédient --</option>`;

    state.ingredients.forEach(ing => {
        const op = document.createElement("option");
        op.value = ing.nom;
        op.textContent = ing.nom;
        sel.appendChild(op);
    });
}

/* =====================================================
       BLOC 3A – COÛT DE REVIENT DES RECETTES
   ===================================================== */

/*
 Structure attendue des ingrédients :
 ingrédients[] = [
   { nom: "Farine", prix: 900, qt: 1000, unit: "g" }
   { nom: "Sucre", prix: 600, qt: 500, unit: "g" }
   { nom: "Margarine", prix: 1200, qt: 500, unit: "g" }
   etc...
]
*/

/**
 * Convertit une quantité d’une unité à une autre
 */
function convertUnit(qte, from, to) {
    if (from === to) return qte;

    // grammes → kilogrammes
    if (from === "g" && to === "kg") return qte / 1000;
    if (from === "kg" && to === "g") return qte * 1000;

    // millilitres → litres
    if (from === "ml" && to === "l") return qte / 1000;
    if (from === "l" && to === "ml") return qte * 1000;

    return qte; // fallback
}

/**
 * Retourne le coût total d'un ingrédient pour une recette.
 */
function getIngredientCost(recIng) {
    // On cherche l’ingrédient dans le STOCK
    const ing = state.ingredients.find(i => i.nom === recIng.nom);
    if (!ing) return 0;

    // Prix d’1 unité (g, ml, etc.)
    const prixUnitaire = ing.prix / ing.qt;

    // On convertit la quantité de la recette vers l’unité du stock
    const qteConvertie = convertUnit(recIng.qte, recIng.unit, ing.unit);

    return qteConvertie * prixUnitaire;
}

/**
 * Consomme les ingrédients d'une recette et ajoute les gaufres produites
 */
function consumeStockForRecipe(recette) {
    let manquants = [];

    recette.ingredients.forEach(recIng => {
        const stockIng = state.ingredients.find(ing => ing.nom === recIng.nom);
        if (!stockIng) return;

        // quantité à déduire convertie dans l'unité du stock
        const qteToDeduct = convertUnit(recIng.qte, recIng.unit, stockIng.unit);

        if (stockIng.stock == null) {
            stockIng.stock = stockIng.qt || 0;
        }

        if (stockIng.stock < qteToDeduct) {
            const manque = qteToDeduct - stockIng.stock;
            manquants.push(
                `${recIng.nom} (manque ${manque.toFixed(2)} ${stockIng.unit})`
            );
            stockIng.stock = 0;
        } else {
            stockIng.stock -= qteToDeduct;
        }
    });

    saveIngredients();
    renderIngredients();

    // Si on a pu consommer le stock correctement, on ajoute les gaufres produites
    if (!manquants.length && recette.nbGaufres) {
        stockGaufres += recette.nbGaufres;
        saveStockGaufres();
    }

    if (typeof updateDashboard === "function") {
        updateDashboard();
    }

    if (manquants.length) {
        alert(
            "Attention, stock insuffisant pour certains ingrédients :\n" +
            manquants.join("\n")
        );
    } else {
        alert("Stock mis à jour pour cette recette.");
    }
}

/**
 * Bouton sur la carte recette : applique 1x la recette au stock
 */
function applyRecipeToStock(index) {
    const rec = recettes[index];
    if (!rec) return;

    const ok = confirm(
        `Déduire du stock ingrédients et ajouter ${rec.nbGaufres} gaufres pour 1x "${rec.nom}" ?`
    );
    if (!ok) return;

    consumeStockForRecipe(rec);
}

/**
 * Calcule le coût total d'une recette et le coût de revient par gaufre
 */
function getCoutDeRevient(recette) {
    let total = 0;

    if (!recette || !Array.isArray(recette.ingredients)) {
        return { total: 0, parGaufre: 0 };
    }

    recette.ingredients.forEach(recIng => {
        total += getIngredientCost(recIng);
    });

    const parGaufre =
        recette.nbGaufres && recette.nbGaufres > 0
            ? total / recette.nbGaufres
            : 0;

    return { total, parGaufre };
}


/**
 * Bouton sur la carte recette : applique 1x la recette au stock
 */
function applyRecipeToStock(index) {
    const rec = recettes[index];
    if (!rec) return;

    const ok = confirm(
        `Déduire du stock tous les ingrédients pour 1x "${rec.nom}" ?`
    );
    if (!ok) return;

    consumeStockForRecipe(rec);
}


/* =====================================================
       AJOUT INGREDIENT DANS LA RECETTE (temporaire)
   ===================================================== */

function refreshRecIngredientsList() {
    const list = document.getElementById("rec-ingredients-list");
    if (!list) return;

    if (!recetteBuffer.ingredients.length) {
        list.innerHTML = "<em>Aucun ingrédient ajouté pour le moment.</em>";
        return;
    }

    const rows = recetteBuffer.ingredients.map((i, idx) => {
        const stockIng = state.ingredients.find(ing => ing.nom === i.nom);

        const qteRecette = `${i.qte} ${i.unit}`;
        const qtePaquet  = stockIng ? `${stockIng.qt} ${stockIng.unit}` : "-";
        const prixPaquet = stockIng ? `${stockIng.prix} FCFA` : "-";
        const coutUtilise = stockIng
            ? `${getIngredientCost(i).toFixed(0)} FCFA`
            : "-";

        return `
            <tr>
                <td>
                    <input type="text" value="${i.nom}" readonly>
                </td>
                <td>
                    <input type="text" value="${qteRecette}" readonly>
                </td>
                <td>
                    <input type="text" value="${qtePaquet}" readonly>
                </td>
                <td>
                    <input type="text" value="${prixPaquet}" readonly>
                </td>
                <td>
                    <input type="text" value="${coutUtilise}" readonly>
                </td>
                <td class="recette-actions" style="text-align:center;">
                    <button class="btn btn-danger btn-mini" onclick="removeIngFromRec(${idx})">
                        ✕
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    list.innerHTML = `
        <div class="table-wrapper">
            <table class="stock-table recette-table">
                <thead>
                    <tr>
                        <th>INGRÉDIENT</th>
                        <th>QTÉ RECETTE</th>
                        <th>QTÉ PAQUET</th>
                        <th>PRIX PAQUET (FCFA)</th>
                        <th>COÛT UTILISÉ (FCFA)</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
            <div class="recette-footer-actions">
                <button type="button" class="btn btn-secondary btn-mini" disabled>
                    + Ajouter un ingrédient (formulaire ci-dessus)
                </button>
                <button type="button" class="btn btn-pink btn-mini" onclick="saveRecIngredients()">
                    Sauvegarder ingrédients
                </button>
            </div>
        </div>
    `;
}


function refreshRecIngredientsList() {
    const list = document.getElementById("rec-ingredients-list");
    if (!list) return;

    if (!recetteBuffer.ingredients.length) {
        list.innerHTML = "<em>Aucun ingrédient ajouté pour le moment.</em>";
        return;
    }

    const rows = recetteBuffer.ingredients.map((i, idx) => {
        const stockIng = state.ingredients.find(ing => ing.nom === i.nom);

        const qtePaquet  = stockIng ? `${stockIng.qt} ${stockIng.unit}` : "-";
        const prixPaquet = stockIng ? `${stockIng.prix} FCFA` : "-";
        const coutUtilise = stockIng
            ? `${getIngredientCost(i).toFixed(0)} FCFA`
            : "-";

        return `
            <tr>
                <td>${i.nom}</td>
                <td>
                    <input 
                        type="number" 
                        min="0" 
                        step="0.01" 
                        value="${i.qte}" 
                        onchange="updateRecIngQte(${idx}, this.value)"
                    >
                    <span class="recette-unit">${i.unit}</span>
                </td>
                <td>
                    <input type="text" value="${qtePaquet}" readonly>
                </td>
                <td>
                    <input type="text" value="${prixPaquet}" readonly>
                </td>
                <td>
                    <input type="text" value="${coutUtilise}" readonly>
                </td>
                <td class="recette-actions" style="text-align:center;">
                    <button class="btn btn-danger btn-mini" onclick="removeIngFromRec(${idx})">
                        ✕
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    list.innerHTML = `
        <div class="table-wrapper">
            <table class="stock-table recette-table">
                <thead>
                    <tr>
                        <th>INGRÉDIENT</th>
                        <th>QTÉ RECETTE</th>
                        <th>QTÉ PAQUET</th>
                        <th>PRIX PAQUET (FCFA)</th>
                        <th>COÛT UTILISÉ (FCFA)</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
            <div class="recette-footer-actions">
                <button type="button" class="btn btn-secondary btn-mini" disabled>
                    + Ajouter un ingrédient (formulaire ci-dessus)
                </button>
                <button type="button" class="btn btn-pink btn-mini" onclick="saveRecIngredients()">
                    Sauvegarder ingrédients
                </button>
            </div>
        </div>
    `;
}

function removeIngFromRec(index) {
    recetteBuffer.ingredients.splice(index, 1);
    refreshRecIngredientsList();
}
function updateRecIngQte(index, newValue) {
    const v = parseFloat(newValue);
    if (!isNaN(v) && v >= 0) {
        recetteBuffer.ingredients[index].qte = v;
    } else {
        recetteBuffer.ingredients[index].qte = 0;
    }
    // On relance l'affichage pour recalculer le coût utilisé
    refreshRecIngredientsList();
}

document.getElementById("rec-add-ingredient-btn")?.addEventListener("click", () => {
    const ing = document.getElementById("rec-ingredient-select").value;
    const qte = parseFloat(document.getElementById("rec-ingredient-qte").value);
    const unit = document.getElementById("rec-ingredient-unit").value;

    if (!ing) {
        alert("Veuillez choisir un ingrédient.");
        return;
    }
    if (isNaN(qte) || qte <= 0) {
        alert("Quantité invalide.");
        return;
    }

    recetteBuffer.ingredients.push({ nom: ing, qte, unit });
    refreshRecIngredientsList();
});

/* =====================================================
           SAUVEGARDER UNE RECETTE COMPLÈTE
   ===================================================== */

document.getElementById("btn-save-recipe")?.addEventListener("click", () => {
    const nom = document.getElementById("rec-nom").value.trim();
    const nbGaufres = parseInt(document.getElementById("rec-nb-gaufres").value);
    const prixVente = parseFloat(document.getElementById("rec-prix-vente").value) || 0;

    if (!nom) {
        alert("La recette doit avoir un nom.");
        return;
    }
    if (isNaN(nbGaufres) || nbGaufres <= 0) {
        alert("Le nombre de gaufres obtenues doit être positif.");
        return;
    }
    if (!recetteBuffer.ingredients.length) {
        alert("Ajoutez au moins un ingrédient.");
        return;
    }

    const nouvelleRecette = {
        nom,
        nbGaufres,
        prixVente,
        ingredients: [...recetteBuffer.ingredients]
    };

    let message;

    if (recetteEditIndex !== null) {
        const ancienne = recettes[recetteEditIndex];
        const ok = confirm(
            `Tu confirmes la mise à jour de la recette "${ancienne.nom}" ?\n` +
            `L'ancienne version sera remplacée.`
        );
        if (!ok) return;

        recettes[recetteEditIndex] = nouvelleRecette;
        recetteEditIndex = null;

        const btn = document.getElementById("btn-save-recipe");
        if (btn) btn.textContent = "Enregistrer la recette";

        message = "Recette mise à jour avec succès !";
    } else {
        recettes.push(nouvelleRecette);
        message = "Recette enregistrée avec succès !";
    }

    saveRecettes();

    // reset buffer
    recetteBuffer = { nom: "", nbGaufres: 0, ingredients: [] };
    saveRecetteBuffer();

    document.getElementById("rec-nom").value = "";
    document.getElementById("rec-nb-gaufres").value = "";
    const prixInput = document.getElementById("rec-prix-vente");
    if (prixInput) prixInput.value = "";

    refreshRecIngredientsList();
    refreshRecetteList();

    alert(message);
});





/* =====================================================
             AFFICHAGE LISTE DES RECETTES
   ===================================================== */

function refreshRecetteList() {
    const container = document.getElementById("rec-liste");
    if (!container) return;

    if (!recettes.length) {
        container.innerHTML = "<em>Aucune recette enregistrée.</em>";
        return;
    }

    container.innerHTML = recettes.map((rec, index) => {
        const cout = getCoutDeRevient(rec);
        const prixVente = rec.prixVente || 0;

        let blocMarge = "";
       if (prixVente > 0 && cout.parGaufre > 0) {
    const margeParGaufre = prixVente - cout.parGaufre;
    const margeTotale = margeParGaufre * rec.nbGaufres;
    blocMarge = `
        <p><strong>Prix de vente (1 produit fini) :</strong> ${prixVente.toFixed(0)} FCFA</p>
        <p><strong>Marge par produit fini :</strong> ${margeParGaufre.toFixed(1)} FCFA</p>
        <p><strong>Marge totale (recette) :</strong> ${margeTotale.toFixed(0)} FCFA</p>
    `;
}

        const ingredientsHtml = rec.ingredients.map(i => {
            const stockIng = state.ingredients.find(ing => ing.nom === i.nom);
            const baseText = `${i.qte} ${i.unit}`;
            if (!stockIng) {
                return `<li>${i.nom} : ${baseText} — (ingrédient non trouvé dans le stock)</li>`;
            }
            const coutUtilise = getIngredientCost(i);
            return `<li>${i.nom} : ${baseText} — paquet : ${stockIng.qt} ${stockIng.unit} — ${stockIng.prix} FCFA — coût utilisé : ${coutUtilise.toFixed(0)} FCFA</li>`;
        }).join("");

        return `
        <div class="recipe-card">
        <h3>${rec.nom}</h3>
        <p><strong>Produits finis obtenus :</strong> ${rec.nbGaufres}</p>
        <p><strong>Coût total de la préparation :</strong> ${cout.total.toFixed(0)} FCFA</p>
        <p><strong>Coût de revient par produit fini :</strong> ${cout.parGaufre.toFixed(1)} FCFA</p>
        ${blocMarge}
        <strong>Ingrédients :</strong>
            <ul>
                ${ingredientsHtml}
            </ul>

            <button class="btn btn-primary" onclick="applyRecipeToStock(${index})">
                Déduire du stock (1x)
            </button>
            <button class="btn btn-secondary" onclick="editRecette(${index})">Modifier</button>
            <button class="btn btn-danger" onclick="deleteRecette(${index})">Supprimer</button>
        </div>`;
    }).join("");
}




/* =====================================================
           ÉDITION D'UNE RECETTE
   ===================================================== */

function editRecette(index) {
    const rec = recettes[index];
    if (!rec) return;

    // On mémorise qu'on édite cette recette
    recetteEditIndex = index;

    // On charge la recette dans le buffer
    recetteBuffer = {
        nom: rec.nom,
        nbGaufres: rec.nbGaufres,
        ingredients: rec.ingredients.map(i => ({ ...i }))
    };
    saveRecetteBuffer();

    // On remplit le formulaire
    const nomInput = document.getElementById("rec-nom");
    const nbInput = document.getElementById("rec-nb-gaufres");
    const prixInput = document.getElementById("rec-prix-vente");

    if (nomInput) nomInput.value = rec.nom;
    if (nbInput) nbInput.value = rec.nbGaufres;
    if (prixInput) prixInput.value = rec.prixVente || 0;

    // On réaffiche la liste des ingrédients de la recette
    refreshRecIngredientsList();

    // On met à jour le texte du bouton
    const btn = document.getElementById("btn-save-recipe");
    if (btn) btn.textContent = "Mettre à jour la recette";
}



/* =====================================================
           SUPPRESSION D'UNE RECETTE
   ===================================================== */

function deleteRecette(index) {
    if (!confirm("Supprimer cette recette ?")) return;

    recettes.splice(index, 1);
    saveRecettes();
    refreshRecetteList();
}

/* =====================================================
             CHARGEMENT AU DEMARRAGE
   ===================================================== */




    loadIngredientSelectForRecipe();
    refreshRecetteList();
    refreshRecIngredientsList();
    showPage("home");

/* ======================== NAVIGATION ======================== */

function showPage(id) {
    // 1. Cacher toutes les pages
    document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));

    // 2. Enlever l’état "active" sur tous les boutons
    document.querySelectorAll(".navbar button").forEach(btn => btn.classList.remove("active"));

    // 3. Afficher la page demandée + activer l’onglet
    const page = document.querySelector("#page-" + id);
    const tab  = document.querySelector("#tab-" + id);

    if (page) page.classList.remove("hidden");
    if (tab)  tab.classList.add("active");

    // 4. Rafraîchir selon la page
    if (id === "dashboard")       updateDashboard();
    else if (id === "ventes")     reloadVentesUI();
    else if (id === "packs")      renderPacks();
    else if (id === "vendeurs")   renderVendeurs();
    else if (id === "depenses")   renderDepenses();
    else if (id === "historique") renderHistorique();
    else if (id === "ingredients") renderIngredients();
    else if (id === "recettes") {
        loadIngredientSelectForRecipe();
        refreshRecetteList();
        refreshRecIngredientsList();
    }

    // 5. FORCER LA POSITION EN HAUT, SANS ANIMATION
    document.documentElement.scrollTop = 0; // pour la plupart des navigateurs
    document.body.scrollTop = 0;           // fallback
}



// Remplit la zone "Packs vendus" de la page Ventes (liste déroulante + packs choisis)
function renderVentePacksFromState() {
    const select = document.getElementById("vente-pack-select");
    const list = document.getElementById("vente-packs-choisis");
    if (!select || !list) return;

    // On repart sur une nouvelle vente quand on arrive sur la page
    venteCourantePacks = [];

    // 1. Remplir la liste déroulante avec les packs existants
    select.innerHTML = `<option value="">-- Choisir un pack --</option>`;

    if (!state.packs.length) {
        list.innerHTML =
            "<p>Aucun pack défini. Va d’abord dans l’onglet <strong>Packs</strong> pour en créer.</p>";
        return;
    }

    state.packs.forEach((p, index) => {
        const opt = document.createElement("option");
        opt.value = index; // index du pack dans state.packs
       opt.textContent = `${p.nom} – ${p.nb} produits finis – ${p.prix} FCFA`;
        select.appendChild(opt);
    });

    // 2. Afficher la (nouvelle) liste des packs ajoutés à la vente
    renderSelectedPacksUI();
}

// Affichage de la liste des packs déjà ajoutés à la vente
function renderSelectedPacksUI() {
    const list = document.getElementById("vente-packs-choisis");
    if (!list) return;

    if (!venteCourantePacks.length) {
        list.innerHTML = "<em>Aucun pack encore ajouté pour cette vente.</em>";
        return;
    }

    list.innerHTML = venteCourantePacks.map((p, i) => `
        <div class="vente-pack-item">
          <span>${p.nom} – ${p.nbGaufres} produits finis – ${p.prixPack} FCFA / pack</span>
            <span>Quantité : <strong>${p.quantite}</strong></span>
            <button type="button" class="btn btn-mini btn-danger" onclick="removePackFromCurrentSale(${i})">
                X
            </button>
        </div>
    `).join("");
}

// Retirer un pack de la vente courante
function removePackFromCurrentSale(index) {
    venteCourantePacks.splice(index, 1);
    renderSelectedPacksUI();
}
// Ajoute un pack (depuis la liste déroulante) à la vente en cours
function addPackToCurrentSale() {
    const select = document.getElementById("vente-pack-select");
    const qteInput = document.getElementById("vente-pack-qte");
    if (!select || !qteInput) return;

    const idxStr = select.value;
    const qte = parseInt(qteInput.value);

    if (idxStr === "") {
        alert("Choisis d'abord un pack.");
        return;
    }
    if (isNaN(qte) || qte <= 0) {
        alert("Quantité de packs invalide.");
        return;
    }

    const index = parseInt(idxStr, 10);
    const p = state.packs[index];
    if (!p) return;

    // Si le pack est déjà présent dans la vente, on incrémente la quantité
    const existing = venteCourantePacks.find(pk => pk.packIndex === index);
    if (existing) {
        existing.quantite += qte;
    } else {
        venteCourantePacks.push({
            packIndex: index,
            nom: p.nom,
            nbGaufres: p.nb,
            prixPack: p.prix,
            quantite: qte
        });
    }

    // Reset du champ quantité, rafraîchissement du résumé
    qteInput.value = 1;
    renderSelectedPacksUI();
}

/* ======================== VENDEURS ======================== */

function addVendeur() {
    const nom = document.getElementById("vendeur-nom").value.trim();
    const commission = document.getElementById("vendeur-commission").value.trim();

    if (!nom) return alert("Nom du vendeur obligatoire.");

    state.vendeurs.push({ nom, commission });
    saveState();
    renderVendeurs();
    reloadVentesUI();

    document.getElementById("vendeur-nom").value = "";
    document.getElementById("vendeur-commission").value = "";
}

function renderVendeurs() {
    const box = document.getElementById("vendeurs-list");
    box.innerHTML = "";

    if (state.vendeurs.length === 0) {
        box.innerHTML = "<p>Aucun vendeur enregistré.</p>";
        return;
    }

    state.vendeurs.forEach((v, index) => {
        const div = document.createElement("div");
        div.className = "card";
        div.innerHTML = `
            <strong>${v.nom}</strong><br>
            Commission : ${v.commission}<br><br>
            <button class="btn btn-danger" onclick="deleteVendeur(${index})">Supprimer</button>
        `;
        box.appendChild(div);
    });
}

function deleteVendeur(i) {
    if (!confirm("Supprimer ce vendeur ?")) return;
    state.vendeurs.splice(i, 1);
    saveState();
    renderVendeurs();
    reloadVentesUI();
}

/* Pour la liste déroulante des ventes – nouvelle version (mode C2) */
function reloadVentesUI() {
    // Remplit la liste des vendeurs, les packs, et affiche les ventes
    renderVentesVendeurs();
    renderVentePacksFromState();
    renderSalesList();
}


/* ======================== PACKS ======================== */

function addPack() {
    const nom = document.getElementById("pack-nom").value.trim();
    const nb = parseInt(document.getElementById("pack-qte").value);
    const prix = parseInt(document.getElementById("pack-prix").value);

    if (!nom || isNaN(nb) || nb <= 0) return alert("Données pack invalides.");
    if (isNaN(prix) || prix < 0) return alert("Prix de pack invalide.");

    state.packs.push({ nom, nb, prix });
    saveState();
    renderPacks();
    reloadVentesUI();

    document.getElementById("pack-nom").value = "";
    document.getElementById("pack-qte").value = "";
    document.getElementById("pack-prix").value = "";
}

function renderPacks() {
    const box = document.getElementById("packs-list");
    box.innerHTML = "";

    if (state.packs.length === 0) {
        box.innerHTML = "<p>Aucun pack enregistré.</p>";
        return;
    }

    state.packs.forEach((p, index) => {
        const div = document.createElement("div");
        div.className = "card";
        div.innerHTML = `
    <strong>${p.nom}</strong> – ${p.nb} produits finis<br><br>
    <button class="btn btn-danger" onclick="deletePack(${index})">Supprimer</button>
`;

        box.appendChild(div);
    });
}

function deletePack(i) {
    if (!confirm("Supprimer ce pack ?")) return;
    state.packs.splice(i, 1);
    saveState();
    renderPacks();
    reloadVentesUI();
}

/* ======================== VENTES (ancienne structure, gardée mais sécurisée) ======================== */

function addVente() {
    const vendeur = document.getElementById("vente-vendeur").value;
    const type = document.getElementById("vente-type")?.value;
    const qty = parseInt(document.getElementById("vente-qty")?.value || "0");

    if (!vendeur || !type || qty <= 0) return alert("Données de vente invalides.");

    state.ventesJour.push({ vendeur, type, qty });
    saveState();
    renderVentesJour();

    if (document.getElementById("vente-qty")) {
        document.getElementById("vente-qty").value = 1;
    }
}

function renderVentesJour() {
    const box = document.getElementById("vente-list");
    if (!box) return;
    box.innerHTML = "";

    if (state.ventesJour.length === 0) {
        box.innerHTML = "<p>Aucune vente aujourd'hui.</p>";
        return;
    }

    state.ventesJour.forEach((v, i) => {
        const div = document.createElement("div");
        div.className = "card";
        div.innerHTML = `
            ${v.vendeur} – ${formatType(v.type)} × ${v.qty}<br><br>
            <button class="btn btn-danger" onclick="deleteVente(${i})">Supprimer</button>
        `;
        box.appendChild(div);
    });
}

function deleteVente(i) {
    state.ventesJour.splice(i, 1);
    saveState();
    renderVentesJour();
}

function formatType(t) {
    if (t === "unite") return "Unité";
    if (t?.startsWith("pack:")) {
        const n = t.split(":")[1];
        return `Pack ${n}`;
    }
    return t || "";
}

/* ======================== DÉPENSES ======================== */

function addDepense() {
    const cat = document.getElementById("dep-cat").value.trim();
    const montant = parseInt(document.getElementById("dep-montant").value);
    const note = document.getElementById("dep-note").value.trim();

    if (!cat || montant <= 0) return alert("Infos dépense invalides.");

    state.depensesJour.push({ cat, montant, note });
    saveState();
    renderDepenses();

    document.getElementById("dep-cat").value = "";
    document.getElementById("dep-montant").value = "";
    document.getElementById("dep-note").value = "";
}

function renderDepenses() {
    const box = document.getElementById("depenses-list");
    box.innerHTML = "";

    if (state.depensesJour.length === 0) {
        box.innerHTML = "<p>Aucune dépense aujourd'hui.</p>";
        return;
    }

    state.depensesJour.forEach((d, i) => {
        const div = document.createElement("div");
        div.className = "card";
        div.innerHTML = `
            <strong>${d.cat}</strong> – ${d.montant} FCFA<br>
            ${d.note || ""}<br><br>
            <button class="btn btn-danger" onclick="deleteDepense(${i})">Supprimer</button>
        `;
        box.appendChild(div);
    });
}

function deleteDepense(i) {
    state.depensesJour.splice(i, 1);
    saveState();
    renderDepenses();
}

/* ======================== ENREGISTREMENT JOURNÉE ======================== */

function saveJournee() {

    if (state.ventesJour.length === 0)
        return alert("Aucune vente à enregistrer.");

    const totalGaufres = calcTotalGaufres();
    const ca = calcCA();
    const dep = calcDepenses();
    const marge = ca - dep;

    const rec = {
        date: new Date().toISOString().slice(0, 10),
        ventes: state.ventesJour,
        depenses: state.depensesJour,
        totalGaufres,
        ca,
        dep,
        marge
    };

    state.historique.push(rec);

    // Reset du jour
    state.ventesJour = [];
    state.depensesJour = [];
    saveState();

    alert("Journée enregistrée !");
    showPage("historique");
}

/* ======================== CALCULS ======================== */

function calcTotalGaufres() {
    let total = 0;

    state.ventesJour.forEach(v => {
        if (v.type === "unite") total += v.qty;
        else if (v.type?.startsWith("pack:")) {
            const nb = parseInt(v.type.split(":")[1]);
            total += nb * v.qty;
        }
    });

    return total;
}

function calcCA() {
    return state.ventesJour.reduce((sum, v) => {
        if (v.type === "unite") return sum + (50 * v.qty);
        if (v.type?.startsWith("pack:")) {
            const nb = parseInt(v.type.split(":")[1]);
            return sum + (50 * nb * v.qty);
        }
        return sum;
    }, 0);
}

function calcDepenses() {
    return state.depensesJour.reduce((s, d) => s + d.montant, 0);
}

/* ======================== WHATSAPP (ancienne structure) ======================== */

function shareWhatsapp() {
    if (!DB.sales.length) {
        alert("Aucune vente à partager.");
        return;
    }

    let totalGaufres = 0;
    let totalCA = 0;

    DB.sales.forEach(s => {
        totalGaufres += sTotalGaufres(s);
        totalCA += sTotal(s);
    });

    let msg = "🔥 Résumé des ventes BusinessFood Manager\n";
msg += "© 2025 – Takougang Eddy • Fotsi Global Services\n\n";
    msg += `Total produits finis : ${totalGaufres}\n`;
    msg += `Chiffre d'affaires : ${totalCA} FCFA\n\n`;
    msg += "Détail des ventes :\n";

    DB.sales.forEach(s => {
        const packsText = (Array.isArray(s.packs) && s.packs.length)
            ? s.packs.map(p => `${p.nom} × ${p.quantite}`).join(" · ")
            : "Aucun pack";

        const nbGaufres = sTotalGaufres(s);
        msg += `- ${s.date} ${s.heure || ""} – ${s.vendeur || "?"} – ${s.lieu || "-"} : ${nbGaufres} gaufres, ${packsText}, ${s.unites || 0} unités, ${sTotal(s)} FCFA\n`;
    });

    const url = "https://wa.me/?text=" + encodeURIComponent(msg);
    window.open(url, "_blank");
}

function shareDashboard() {
    // On lit ce qui est affiché sur le tableau de bord
    const totalGaufres = (document.getElementById("dash-total-gaufres")?.textContent || "").trim();
    const revenuTotal  = (document.getElementById("dash-revenu-total")?.textContent || "").trim();
    const depensesTot  = (document.getElementById("dash-depenses")?.textContent || "").trim();
    const benefNet     = (document.getElementById("dash-benefice-net")?.textContent || "").trim();
    const stockGaufres = (document.getElementById("dash-stock-restant")?.textContent || "").trim();
    const capacite     = (document.getElementById("dash-capacite")?.textContent || "").trim();
    const bestVendeur  = (document.getElementById("dash-best-vendeur")?.textContent || "").trim();
    const bestPack     = (document.getElementById("dash-best-pack")?.textContent || "").trim();
    const statsVentes  = (document.getElementById("dash-stats-ventes")?.textContent || "").trim();
    const statsIng     = (document.getElementById("dash-stats-ingredients")?.textContent || "").trim();

    let msg  = "📊 Tableau de bord BusinessFood Manager\n";
msg     += "© 2025 – Takougang Eddy • Fotsi Global Services\n\n";

    msg     += `Total produits finis vendus : ${totalGaufres}\n`;
    msg     += `Revenu total : ${revenuTotal}\n`;
    msg     += `Dépenses totales : ${depensesTot}\n`;
    msg     += `Bénéfice net : ${benefNet}\n`;
    msg     += `Stock de produits finis : ${stockGaufres}\n`;
    msg     += `Capacité restante : ${capacite}\n`;
    msg     += `Meilleur vendeur : ${bestVendeur || "-" }\n`;
    msg     += `Pack le plus vendu : ${bestPack || "-" }\n`;
    msg     += `\n${statsVentes}\n${statsIng}`;

    const url = "https://wa.me/?text=" + encodeURIComponent(msg);
    window.open(url, "_blank");
}


/* =====================================================
   MINI-RECETTE "1 KG DE FARINE" SUR PAGE INGRÉDIENTS
   (bouton : "Ajouter un ingrédient à la recette")
===================================================== */

function addRecetteIngredient() {
    const container = document.getElementById("recette-declaration");
    if (!container) return;

    const row = document.createElement("div");
    row.className = "card recette-ligne";

    // Construire les options à partir des ingrédients existants
    const options = state.ingredients.map(ing => 
        `<option value="${ing.nom}">${ing.nom}</option>`
    ).join("");

    row.innerHTML = `
        <div class="recette-ligne-inner">
            <label>Ingrédient :</label>
            <select class="recette2-ing">
                <option value="">-- Choisir --</option>
                ${options}
            </select>

            <label>Quantité :</label>
            <input type="number" min="0" class="recette2-qte" placeholder="Ex : 250">

            <label>Unité :</label>
            <select class="recette2-unit">
                <option value="g">g</option>
                <option value="kg">kg</option>
                <option value="ml">ml</option>
                <option value="l">L</option>
                <option value="piece">pièce</option>
                <option value="sachet">sachet</option>
            </select>

            <button type="button" class="btn btn-danger btn-mini recette2-remove">
                X
            </button>
        </div>
    `;

    // Suppression de la ligne
    row.querySelector(".recette2-remove").addEventListener("click", () => {
        row.remove();
        updateRecetteBaseCost();
    });

    // Recalcul du coût dès qu'on modifie la ligne
    const ingSelect = row.querySelector(".recette2-ing");
    const qteInput = row.querySelector(".recette2-qte");
    const unitSelect = row.querySelector(".recette2-unit");

    ["change", "input"].forEach(evt => {
        ingSelect.addEventListener(evt, updateRecetteBaseCost);
        qteInput.addEventListener(evt, updateRecetteBaseCost);
        unitSelect.addEventListener(evt, updateRecetteBaseCost);
    });

    container.appendChild(row);
}

/**
 * Recalcule le coût total de la pâte et le coût d'une gaufre
 * en fonction des lignes de "Recette basée sur 1 kg de farine"
 */
function updateRecetteBaseCost() {
    const container = document.getElementById("recette-declaration");
    const spanTotal = document.getElementById("cout-total-pate");
    const spanNbGaufres = document.getElementById("nb-gaufres-pate");
    const spanCoutGaufre = document.getElementById("cout-gaufre");

    if (!container || !spanTotal || !spanNbGaufres || !spanCoutGaufre) return;

    let total = 0;

    const rows = container.querySelectorAll(".recette-ligne");
    rows.forEach(row => {
        const ingName = row.querySelector(".recette2-ing").value;
        const qte = parseFloat(row.querySelector(".recette2-qte").value);
        const unit = row.querySelector(".recette2-unit").value;

        if (!ingName || isNaN(qte) || qte <= 0) return;

        // On réutilise la même logique que pour les recettes complètes
        total += getIngredientCost({ nom: ingName, qte, unit });
    });

    spanTotal.textContent = Math.round(total) + " FCFA";

    // Nombre de gaufres : si 0, on demande une seule fois à l'utilisateur
    let nbGaufres = parseInt(spanNbGaufres.textContent, 10);
    if (!nbGaufres || nbGaufres <= 0) {
const saisie = prompt("Avec cette recette, tu obtiens combien de produits finis ?");
        nbGaufres = parseInt(saisie, 10);
        if (!isNaN(nbGaufres) && nbGaufres > 0) {
            spanNbGaufres.textContent = nbGaufres;
        } else {
            nbGaufres = 0;
        }
    }

    const coutParGaufre = nbGaufres > 0 ? total / nbGaufres : 0;
    spanCoutGaufre.textContent = Math.round(coutParGaufre) + " FCFA";
}

/* =====================================================
   MODULE INGREDIENTS — W.E GAUFRES MANAGER v4 PRO
===================================================== */

// Charger les ingrédients depuis le localStorage
state.ingredients = JSON.parse(localStorage.getItem("ingredients") || "[]");

// Indice de l'ingrédient en cours de modification (null = mode ajout)
let ingredientEditIndex = null;


// Sauvegarde des ingrédients
function saveIngredients() {
    localStorage.setItem("ingredients", JSON.stringify(state.ingredients));
}
/* ---------- Alerte stock faible ---------- */
function checkStockAlerts() {
    const low = state.ingredients.filter(
        ing => ing.seuil && ing.stock <= ing.seuil
    );

    if (!low.length) return;

    const message = "⚠ Stock faible pour :\n" +
        low.map(ing => `- ${ing.nom} (${ing.stock.toFixed(1)} ${ing.unit})`).join("\n");

    alert(message);
}

/* ---------- Ajouter / modifier / ravitailler un ingrédient ---------- */
function addIngredient() {
    const nom  = document.getElementById("ing-nom").value.trim();
    const prix = parseFloat(document.getElementById("ing-prix").value);
    const qt   = parseFloat(document.getElementById("ing-qt").value);
    const unit = document.getElementById("ing-unit").value;
    const seuilInput = document.getElementById("ing-seuil");
    const seuil = seuilInput ? (parseFloat(seuilInput.value) || 0) : 0;

   if (!nom || isNaN(prix) || prix <= 0 || isNaN(qt) || qt <= 0) {
    alert("Merci de renseigner correctement le nom, le prix d'achat et la quantité.");
    return;
}


    // =====================
    // MODE ÉDITION
    // =====================
    if (ingredientEditIndex !== null && state.ingredients[ingredientEditIndex]) {
        const ing = state.ingredients[ingredientEditIndex];

        // On garde ce qui a déjà été utilisé pour ne pas casser l'historique
        const utiliseAvant = (ing.qt || 0) - (ing.stock || 0);

        ing.nom   = nom;
        ing.prix  = prix;
        ing.qt    = qt;
        ing.unit  = unit;
        ing.seuil = seuil;

        // Nouveau stock = nouvelle quantité - déjà utilisé (minimum 0)
        let nouveauStock = qt - utiliseAvant;
        if (nouveauStock < 0) nouveauStock = 0;
        ing.stock = nouveauStock;

        // On repasse en mode ajout
        ingredientEditIndex = null;
        const btn = document.getElementById("btn-add-ingredient");
        if (btn) btn.textContent = "Ajouter l'ingrédient";
    }

    // =====================
    // MODE AJOUT / RAVITAILLEMENT
    // =====================
    else {
        const existing = state.ingredients.find(
            ing => ing.nom.toLowerCase() === nom.toLowerCase() && ing.unit === unit
        );

        if (existing) {
            const ancienQt = existing.qt || 0;
            const ancienPrixTotal = existing.prix || 0;

            const nouveauQtTotal = ancienQt + qt;
            const nouveauPrixTotal = ancienPrixTotal + prix;

            existing.qt = nouveauQtTotal;
            existing.stock = (existing.stock || 0) + qt; // on rajoute le paquet
            existing.prix = nouveauPrixTotal;

            if (seuil > 0) {
                existing.seuil = seuil;
            }
        } else {
            const newIng = {
                nom,
                prix,        // prix total pour ce paquet
                qt,          // quantité achetée totale
                unit,        // unité
                stock: qt,   // stock initial
                parGaufre: 0,
                seuil
            };
            state.ingredients.push(newIng);
        }
    }

    saveIngredients();
    renderIngredients();
    loadIngredientSelectForRecipe(); // pour la page Recettes

    // Reset champs
    document.getElementById("ing-nom").value  = "";
    document.getElementById("ing-prix").value = "";
    document.getElementById("ing-qt").value   = "";
    if (seuilInput) seuilInput.value = "";
}
/* ---------- Passer un ingrédient en mode édition ---------- */
function editIngredient(index) {
    const ing = state.ingredients[index];
    if (!ing) return;

    document.getElementById("ing-nom").value  = ing.nom || "";
    document.getElementById("ing-prix").value = ing.prix || "";
    document.getElementById("ing-qt").value   = ing.qt || "";
    document.getElementById("ing-unit").value = ing.unit || "g";

    const seuilInput = document.getElementById("ing-seuil");
    if (seuilInput) seuilInput.value = ing.seuil || "";

    ingredientEditIndex = index;

    const btn = document.getElementById("btn-add-ingredient");
    if (btn) btn.textContent = "Mettre à jour l'ingrédient";
}


/* ---------- Supprimer un ingrédient ---------- */
function deleteIngredient(index) {
    if (!confirm("Supprimer cet ingrédient ?")) return;

    state.ingredients.splice(index, 1);
    saveIngredients();
    renderIngredients();
    calcCoutGaufre();
}

/* ---------- Affichage des ingrédients (vue STOCK) ---------- */
function renderIngredients() {
    const box = document.getElementById("ingredients-list");
    box.innerHTML = "";

    if (state.ingredients.length === 0) {
        box.innerHTML = "<p>Aucun ingrédient enregistré.</p>";
        return;
    }

    let totalValeurStock = 0;

    const rows = state.ingredients.map((ing, i) => {
        const prixUnitaire = ing.qt > 0 ? (ing.prix || 0) / ing.qt : 0;
        const utilise = (ing.qt || 0) - (ing.stock || 0);
        const valeurStock = (ing.stock || 0) * prixUnitaire;
        totalValeurStock += valeurStock;

        const alertStock = (ing.seuil && (ing.stock || 0) <= ing.seuil)
            ? "<span style='color:red; font-weight:bold;'>⚠ Stock faible</span>"
            : "";

        return `
            <tr>
                <td>${ing.nom}</td>
                <td>${(ing.qt || 0).toFixed(2)} ${ing.unit}</td>
                <td>${utilise.toFixed(2)} ${ing.unit}</td>
                <td>${(ing.stock || 0).toFixed(2)} ${ing.unit} ${alertStock}</td>
                <td>${Math.round(prixUnitaire)} FCFA</td>
                <td>${Math.round(valeurStock)} FCFA</td> 
         <td>
    <button class="btn btn-secondary btn-mini" onclick="editIngredient(${i})">
        Modifier
    </button>
    <button class="btn btn-danger btn-mini" onclick="deleteIngredient(${i})">
        Supprimer
    </button>
</td>

            </tr>
        `;
    }).join("");

    box.innerHTML = `
        <div class="table-wrapper">
            <table class="stock-table">
                <thead>
                    <tr>
                        <th>Ingrédient</th>
                        <th>Quantité achetée</th>
                        <th>Quantité utilisée</th>
                        <th>Stock restant</th>
                        <th>Prix unitaire</th>
                        <th>Valeur du stock</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
                <tfoot>
                    <tr>
                        <th colspan="5">Valeur totale du stock</th>
                        <th>${Math.round(totalValeurStock)} FCFA</th>
                        <th></th>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;

    // Après affichage, on vérifie les alertes
    checkStockAlerts();
}


/* =====================================================
   DASHBOARD PRO
===================================================== */

function updateDashboard() {
    let totalGaufresVendues = 0;
    let totalRevenu = 0;
    let totalDepense = 0;

    const vendeurStats = {};
    const packStats = {};

    // 1) VENTES (DB.sales contient toutes les ventes)
    DB.sales.forEach(s => {
        const nbGaufres = sTotalGaufres(s);
        const total = sTotal(s);

        totalGaufresVendues += nbGaufres;
        totalRevenu += total;

        if (s.vendeur) {
            vendeurStats[s.vendeur] = (vendeurStats[s.vendeur] || 0) + total;
        }

        if (Array.isArray(s.packs)) {
            s.packs.forEach(p => {
                const key = p.nom || `Pack ${p.nbGaufres || "?"}`;
                packStats[key] = (packStats[key] || 0) + (p.quantite || 0);
            });
        }
    });

    // 2) DÉPENSES (on reste sur les dépenses du jour)
    totalDepense = state.depensesJour.reduce(
        (sum, d) => sum + (d.montant || 0),
        0
    );

    const elGaufres = document.getElementById("dash-total-gaufres");
    const elRevenu = document.getElementById("dash-revenu-total");
    const elDepenses = document.getElementById("dash-depenses");
    const elBenefice = document.getElementById("dash-benefice-net");
    const elStockGaufres = document.getElementById("dash-stock-restant");
    const elCapacite = document.getElementById("dash-capacite");

    if (elGaufres) elGaufres.textContent = totalGaufresVendues;
    if (elRevenu) elRevenu.textContent = totalRevenu + " FCFA";
    if (elDepenses) elDepenses.textContent = totalDepense + " FCFA";
    if (elBenefice) elBenefice.textContent = (totalRevenu - totalDepense) + " FCFA";

    // Stock de gaufres (production - ventes)
   if (elStockGaufres) {
    elStockGaufres.textContent = `${stockGaufres} produits finis restants`;
}

    // Capacité restante selon recettes + stock ingrédients
    const capacite = estimateCapacityFromRecipes();
if (elCapacite) {
    elCapacite.textContent = `${capacite} produits finis possibles`;
}

    // Meilleur vendeur
    const bestV = Object.entries(vendeurStats)
        .sort((a, b) => b[1] - a[1])[0];
    const elBestVendeur = document.getElementById("dash-best-vendeur");
    if (elBestVendeur) {
        elBestVendeur.textContent =
            bestV ? `${bestV[0]} (${bestV[1]} FCFA)` : "Aucun";
    }

    // Pack le plus vendu
    const bestP = Object.entries(packStats)
        .sort((a, b) => b[1] - a[1])[0];
    const elBestPack = document.getElementById("dash-best-pack");
    if (elBestPack) {
        elBestPack.textContent =
            bestP ? `${bestP[0]} (${bestP[1]} vendus)` : "Aucun";
    }

    // Statistiques avancées
    const elStatsVente = document.getElementById("dash-stats-ventes");
    const elStatsIng = document.getElementById("dash-stats-ingredients");

    if (elStatsVente) {
        if (totalGaufresVendues > 0) {
            const prixMoyen = totalRevenu / totalGaufresVendues;
            elStatsVente.textContent =
                `Analyse ventes : ${totalGaufresVendues} gaufres vendues, ` +
                `${totalRevenu} FCFA de CA (~${prixMoyen.toFixed(0)} FCFA / gaufre).`;
        } else {
            elStatsVente.textContent = "Analyse ventes : aucune vente enregistrée.";
        }
    }

    if (elStatsIng) {
        let valeurStock = 0;
        let nbAlertes = 0;

        state.ingredients.forEach(ing => {
            const prixUnitaire = ing.qt > 0 ? (ing.prix || 0) / ing.qt : 0;
            valeurStock += (ing.stock || 0) * prixUnitaire;
            if (ing.seuil && ing.stock <= ing.seuil) nbAlertes++;
        });

        elStatsIng.textContent =
            `Analyse ingrédients : stock ≈ ${Math.round(valeurStock)} FCFA, ` +
            `${nbAlertes} ingrédient(s) sous le seuil.`;
    }
}
// Estimation de la capacité de production restante en gaufres
function estimateCapacityFromRecipes() {
    if (!recettes.length || !state.ingredients.length) return 0;

    const consoParIng = {};

    recettes.forEach(rec => {
        if (!rec.nbGaufres || rec.nbGaufres <= 0) return;

        rec.ingredients.forEach(recIng => {
            const ing = state.ingredients.find(i => i.nom === recIng.nom);
            if (!ing) return;

            const qteStockUnit = convertUnit(recIng.qte, recIng.unit, ing.unit);
            const parGaufre = qteStockUnit / rec.nbGaufres;

            if (!consoParIng[ing.nom]) {
                consoParIng[ing.nom] = { qte: 0, count: 0 };
            }
            consoParIng[ing.nom].qte += parGaufre;
            consoParIng[ing.nom].count += 1;
        });
    });

    let capacite = Infinity;

    Object.keys(consoParIng).forEach(nom => {
        const data = consoParIng[nom];
        const moyParGaufre = data.qte / data.count;
        if (moyParGaufre <= 0) return;

        const ing = state.ingredients.find(i => i.nom === nom);
        if (!ing || ing.stock == null || ing.stock <= 0) return;

        const possible = Math.floor(ing.stock / moyParGaufre);
        if (possible < capacite) capacite = possible;
    });

    if (!isFinite(capacite) || capacite < 0) return 0;
    return capacite;
}



/* ---------- Calcul du coût de revient ---------- */
function calcCoutGaufre() {
    let total = 0;

    state.ingredients.forEach(ing => {
        if (!ing.parGaufre) return;
        const coutUnitaire = ing.prix / ing.qt; // prix pour 1 unité
        const coutGaufre = coutUnitaire * ing.parGaufre;
        total += coutGaufre;
    });

    document.getElementById("cout-gaufre").textContent = Math.round(total) + " FCFA";

    // Prix conseillé selon marge
    const marge = parseFloat(document.getElementById("marge")?.value || "0");
    const prix = total + (total * marge / 100);

    document.getElementById("prix-conseille").textContent = Math.round(prix) + " FCFA";
}

/* ---------- Déduire automatiquement le stock après une journée ---------- */
function deduireStockAprèsVente(totalGaufres) {
    state.ingredients.forEach(ing => {
        if (!ing.parGaufre) return;
        ing.stock -= ing.parGaufre * totalGaufres;

        if (ing.stock < 0) ing.stock = 0;
    });

    saveIngredients();
}

/* ---------- Lors de l'enregistrement de la journée ---------- */
const oldSaveJournee = saveJournee;
saveJournee = function () {
    const totalGaufres = calcTotalGaufres();

    deduireStockAprèsVente(totalGaufres);

    oldSaveJournee(); // on appelle l’ancienne fonction
};

/* ======================== INIT ======================== */
updateDashboard();

/* ============================================
   EXPORT PDF (HISTORIQUE)
============================================ */

async function exportPDF() {
    if (state.historique.length === 0) {
        alert("Aucun historique.");
        return;
    }

    const { jsPDF } = window.jspdf;

    let pdf = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4"
    });

    // On génère le contenu PDF
    let y = 40;
    pdf.setFontSize(18);
    pdf.text("W.E - Historique des ventes", 40, y);
    y += 30;

    pdf.setFontSize(12);

    state.historique.forEach(h => {
        pdf.text(`Date : ${h.date}`, 40, y); y += 18;
        pdf.text(`Gaufres : ${h.totalGaufres}`, 40, y); y += 18;
        pdf.text(`CA : ${h.ca} FCFA`, 40, y); y += 18;
        pdf.text(`Dépenses : ${h.dep} FCFA`, 40, y); y += 18;
        pdf.text(`Marge : ${h.marge} FCFA`, 40, y); 
        y += 30;
    });

    pdf.save("historique_gaufres.pdf");
}
/* ============================================
   AFFICHAGE HISTORIQUE (à partir de DB.sales)
============================================ */

function renderHistorique() {
    const box = document.getElementById("historique-list");
    if (!box) return;

    if (!DB.sales.length) {
        box.innerHTML = "<p>Aucune vente enregistrée pour le moment.</p>";
        return;
    }

    let html = "";

    DB.sales.forEach(s => {
        const vendeurName = s.vendeur || "Inconnu";
        const dateText = `${s.date} à ${s.heure || "-"}`;
        const lieuText = s.lieu || "-";

        // Packs : texte lisible
        let packsText = "Aucun pack";
        if (Array.isArray(s.packs) && s.packs.length) {
            packsText = s.packs
                .map(p => `${p.nom} × ${p.quantite}`)
                .join(" · ");
        }

        const nbGaufres = sTotalGaufres(s);
        const total = sTotal(s);
        const unites = s.unites || 0;

        html += `
            <div class="card history-card">
                <div class="history-header">
                    <span class="history-vendeur">${vendeurName}</span>
                    <span class="history-date">${dateText}</span>
                </div>
                <div class="history-meta">
                    <span class="history-pill">Lieu : ${lieuText}</span>
                    <span class="history-pill">Gaufres : ${nbGaufres}</span>
                    <span class="history-pill">Total : ${total} FCFA</span>
                </div>
                <div class="history-line">
                    <strong>Packs :</strong>
                    <span>${packsText}</span>
                </div>
                <div class="history-line">
                    <strong>Unités :</strong>
                    <span>${unites}</span>
                </div>
            </div>
        `;
    });

    box.innerHTML = html;
}



/* ============================================
   VENTES — MODE C2 PRO (NOUVELLE PAGE)
============================================ */

/* Pré-remplir la liste des vendeurs dans la page ventes */
function renderVentesVendeurs() {
    const sel = document.getElementById("vente-vendeur");
    if (!sel) return;

    sel.innerHTML = "";
    state.vendeurs.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v.nom;
        opt.textContent = v.nom;
        sel.appendChild(opt);
    });
}

/* Ajouter une vente individuelle */
function addSaleFromUI() {
    const date = document.getElementById("vente-date").value;
    const heure = document.getElementById("vente-heure").value;
    const vendeur = document.getElementById("vente-vendeur").value;
    const lieu = document.getElementById("vente-lieu").value;

    const unites = parseInt(document.getElementById("vente-unites").value) || 0;
    const prixUnite = parseInt(document.getElementById("vente-prix-unite").value) || 0;

    if (!date || !vendeur) {
        alert("Merci de remplir au moins la date et le vendeur.");
        return;
    }

        // Packs vendus = ceux que tu as ajoutés via la liste déroulante
    const packsVendus = venteCourantePacks.length
        ? venteCourantePacks.map(p => ({ ...p }))  // copie pour ne pas modifier l'original
        : [];

    if (packsVendus.length === 0 && unites === 0) {
        alert("Merci d'indiquer au moins un pack ou des unités vendues.");
        return;
    }

        const sale = {
        id: Date.now(),
        date,
        heure,
        vendeur,
        lieu,
        packs: packsVendus,
        unites,
        prixUnite
    };

    // On retire les gaufres vendues du stock
    const gaufresVendues = sTotalGaufres(sale);
    stockGaufres -= gaufresVendues;
    if (stockGaufres < 0) stockGaufres = 0;
    saveStockGaufres();

    DB.sales.push(sale);

    saveDB();
    renderSalesList();
    renderHistorique?.();
    updateDashboard?.();

        // reset des quantités
    document.getElementById("vente-unites").value = 0;

    // on vide la vente courante (packs)
    venteCourantePacks = [];
    renderSelectedPacksUI();

    const select = document.getElementById("vente-pack-select");
    const qteInput = document.getElementById("vente-pack-qte");
    if (select) select.value = "";
    if (qteInput) qteInput.value = 1;

    document.getElementById("vente-unites").value = 0;
    state.packs.forEach((p, index) => {
        const input = document.getElementById("vente-pack-qte-" + index);
        if (input) input.value = 0;
    });
}


/* Afficher les ventes du jour */
function renderSalesList() {
    const box = document.getElementById("vente-liste-container");
    if (!box) return;

    box.innerHTML = "";

    DB.sales.forEach(s => {
        const div = document.createElement("div");
        div.className = "card small";

        const vendeurName = s.vendeur || "Inconnu";

        let packsText = "Aucun pack";
        if (Array.isArray(s.packs) && s.packs.length) {
            packsText = s.packs
                .map(p => `${p.nom} x ${p.quantite}`)
                .join(" · ");
        }

        div.innerHTML = `
            <strong>${vendeurName}</strong><br>
            ${s.date} à ${s.heure || "-"}<br>
            Lieu : ${s.lieu || "-"}<br>
            Packs : ${packsText}<br>
            Unités : ${s.unites || 0}<br>
            Total : ${sTotal(s)} FCFA<br>
            <button class="btn btn-secondary btn-xs" onclick="editSale(${s.id})">Modifier</button>
            <button class="btn btn-danger btn-xs" onclick="deleteSale(${s.id})">Supprimer</button>
        `;
        box.appendChild(div);
    });
}

// Supprimer une vente
function deleteSale(id) {
    if (!confirm("Supprimer définitivement cette vente ?")) return;

    const index = DB.sales.findIndex(s => s.id === id);
    if (index === -1) return;

    const sale = DB.sales[index];

    // On remet ces gaufres en stock
    const gaufres = sTotalGaufres(sale);
    stockGaufres += gaufres;
    saveStockGaufres();

    // On enlève la vente
    DB.sales.splice(index, 1);
    saveDB();

    // On rafraîchit l'affichage
    renderSalesList();
    if (typeof renderHistorique === "function") renderHistorique();
    if (typeof updateDashboard === "function") updateDashboard();
}


// Modifier une vente (on la recharge dans le formulaire)
function editSale(id) {
    const index = DB.sales.findIndex(s => s.id === id);
    if (index === -1) return;

    const sale = DB.sales[index];
        // On remet d'abord les gaufres de cette vente en stock
    const gaufresAnciennes = sTotalGaufres(sale);
    stockGaufres += gaufresAnciennes;
    saveStockGaufres();


    // 1. Remplir le formulaire Ventes
    document.getElementById("vente-date").value = sale.date || "";
    document.getElementById("vente-heure").value = sale.heure || "";
    document.getElementById("vente-vendeur").value = sale.vendeur || "";
    document.getElementById("vente-lieu").value = sale.lieu || "";
    document.getElementById("vente-unites").value = sale.unites || 0;
    document.getElementById("vente-prix-unite").value = sale.prixUnite || 0;

        // 2. Recharger les packs de cette vente dans la vente courante
    venteCourantePacks = Array.isArray(sale.packs)
        ? sale.packs.map(p => ({ ...p }))
        : [];
    renderSelectedPacksUI();

    if (Array.isArray(state.packs)) {
        state.packs.forEach((p, i) => {
            const input = document.getElementById("vente-pack-qte-" + i);
            if (!input) return;

            let qte = 0;
            if (Array.isArray(sale.packs)) {
                const found = sale.packs.find(pk => pk.packIndex === i);
                if (found) qte = found.quantite || 0;
            }
            input.value = qte;
        });
    }

    // 3. On supprime l'ancienne vente : la prochaine "Enregistrer la vente"
    // correspondra à la version corrigée
    DB.sales.splice(index, 1);
    saveDB();
    renderSalesList();
    if (typeof renderHistorique === "function") renderHistorique();
    if (typeof updateDashboard === "function") updateDashboard();
}

/* Calculer le CA d'une vente (packs + unités) */
function sTotal(s) {
    let total = 0;

    // Packs : prix au pack
    if (Array.isArray(s.packs)) {
        s.packs.forEach(p => {
            total += (p.quantite || 0) * (p.prixPack || 0);
        });
    }

    // Unités à l'unité
    if (s.unites && s.prixUnite) {
        total += s.unites * s.prixUnite;
    }

    return total;
}

/* Calculer le nombre total de gaufres d'une vente */
function sTotalGaufres(s) {
    let total = 0;

    if (Array.isArray(s.packs)) {
        s.packs.forEach(p => {
            total += (p.quantite || 0) * (p.nbGaufres || 0);
        });
    }

    total += s.unites || 0;
    return total;
}

/* ======================== INIT GLOBAL ======================== */

document.addEventListener("DOMContentLoaded", () => {
    // Page affichée au démarrage
    showPage("home"); // "home" correspond à <section id="page-home">

    // VENTES
    const btnEnregistrerVente = document.getElementById("btn-enregistrer-vente");
    if (btnEnregistrerVente) {
        btnEnregistrerVente.addEventListener("click", addSaleFromUI);
    }

    const btnAddPackToSale = document.getElementById("vente-pack-add-btn");
    if (btnAddPackToSale) {
        btnAddPackToSale.addEventListener("click", addPackToCurrentSale);
    }

    // PACKS
    const btnAddPack = document.getElementById("btn-add-pack");
    if (btnAddPack) {
        btnAddPack.addEventListener("click", addPack);
    }

    // INGREDIENTS
    const btnAddIng = document.getElementById("btn-add-ingredient");
    if (btnAddIng) {
        btnAddIng.addEventListener("click", addIngredient);
    }

    // RECETTES : listes / sélecteurs
    loadIngredientSelectForRecipe();
    refreshRecetteList();
    refreshRecIngredientsList();

    // Rendu initial
    reloadVentesUI();
    renderPacks();
    renderVendeurs();
    renderVentesJour();
    renderDepenses();
    renderHistorique();
    updateDashboard();
    renderIngredients();
});
