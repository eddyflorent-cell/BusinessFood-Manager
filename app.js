/* BusinessFood Manager — app.js (v6 consolidé: édition recettes + déduction xN + packs stock + profils export/import)
   - Basé sur les IDs / pages de BusinessFood-Manager.html
   - Stockage local (localStorage)
   - Navigation, config, ingrédients, recettes (production), packs, ventes, dépenses, dashboard, historique, exports
*/

(() => {
  "use strict";

  /* =========================
     0) Helpers
  ========================== */
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const on = (el, evt, fn, opts) => { if (el) el.addEventListener(evt, fn, opts); };

  // Robust container lookup for "Stock actuel" list (supports multiple HTML variants)
  const getIngredientsListContainer = () => {
    const ids = ["ingredients-list", "ingredients-stock-list", "stock-current-list", "stock-actuel-list", "stock-ingredients-list"];
    for (const id of ids) {
      const el = $(id);
      if (el) return el;
    }
    return document.querySelector('#page-ingredients [data-role="ingredients-list"]')
        || document.querySelector('#page-ingredients .ingredients-list')
        || null;
  };


  const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const toNum = (v, def = 0) => {
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : def;
  };
  const pad2 = (n) => String(n).padStart(2, "0");

  const money = (n) => {
    const v = Math.round(toNum(n, 0));
    try { return v.toLocaleString("fr-FR") + " FCFA"; } catch { return `${v} FCFA`; }
  };

  const dateISO = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const timeISO = (d = new Date()) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  const safeText = (s) => String(s ?? "").trim();

  function unitToBaseQty(qty, unit) {
    // base: g | ml | piece
    const q = toNum(qty, 0);
    const u = String(unit || "").toLowerCase();
    if (u === "kg") return { baseQty: q * 1000, baseUnit: "g" };
    if (u === "g")  return { baseQty: q, baseUnit: "g" };
    if (u === "l" || u === "L".toLowerCase()) return { baseQty: q * 1000, baseUnit: "ml" };
    if (u === "ml") return { baseQty: q, baseUnit: "ml" };
    // piece / sachet / autre => piece
    return { baseQty: q, baseUnit: "piece" };
  }

  function baseQtyToDisplay(baseQty, baseUnit, displayUnit) {
    const q = toNum(baseQty, 0);
    const u = String(displayUnit || "").toLowerCase();
    if (baseUnit === "g") {
      if (u === "kg") return q / 1000;
      return q; // g
    }
    if (baseUnit === "ml") {
      if (u === "l" || u === "L".toLowerCase()) return q / 1000;
      return q; // ml
    }
    return q; // piece
  }

  function baseUnitDefaultDisplay(baseUnit) {
    if (baseUnit === "g") return "g";
    if (baseUnit === "ml") return "ml";
    return "piece";
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, String(v));
    });
    for (const child of children) {
      if (child == null) continue;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }
const SUBS_PREFIX = "BFM1.";
const SUBS_SECRET = "BFM_PHASE1_SECRET_CHANGE_ME_2025_12_14"; // EXACTEMENT le même que le générateur
const DEVICE_ID_KEY = "BFM_DEVICE_ID_V1";

function getOrCreateDeviceId() {
  let did = (localStorage.getItem(DEVICE_ID_KEY) || "").trim();
  if (did) return did;
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const rnd = Math.random().toString(36).slice(2, 10).toUpperCase();
  did = `BFM-${y}${m}${da}-${rnd}`;
  localStorage.setItem(DEVICE_ID_KEY, did);
  return did;
}

function b64urlEncodeBytes(bytes) {
  let bin = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecodeToBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlDecodeText(b64url) {
  return new TextDecoder().decode(b64urlDecodeToBytes(b64url));
}

async function hmacSha256B64Url(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64urlEncodeBytes(sig);
}

async function verifySignedActivationCode(code, expectedDid) {
  const raw = String(code || "").trim();
  if (!raw.startsWith(SUBS_PREFIX)) return { ok: false, reason: "FORMAT" };

  const rest = raw.slice(SUBS_PREFIX.length);
  const parts = rest.split(".");
  if (parts.length !== 2) return { ok: false, reason: "FORMAT" };

  const payloadB64 = parts[0];
  const sigB64 = parts[1];

  const expectedSig = await hmacSha256B64Url(payloadB64, SUBS_SECRET);
  if (sigB64 !== expectedSig) return { ok: false, reason: "SIGNATURE" };

  const payload = JSON.parse(b64urlDecodeText(payloadB64));
  if (!payload || payload.v !== 1) return { ok: false, reason: "PAYLOAD" };

  const did = String(payload.did || "").trim();
  const days = Number(payload.days);

  if (!did || did !== expectedDid) return { ok: false, reason: "DEVICE" };
  if (!Number.isFinite(days) || days <= 0 || days > 3650) return { ok: false, reason: "DAYS" };

  return { ok: true, payload };
}

  /* =========================
     1) Storage
  ========================== */
  const STORE_KEY = "BFM_STATE_V3";

  const PROFILES_KEY = "BFM_PROFILES_V1";

    function nowISO() { return new Date().toISOString(); }

    function loadProfilesIndex() {
      try {
        const raw = localStorage.getItem(PROFILES_KEY);
        if (raw) {
          const idx = JSON.parse(raw);
          if (idx && Array.isArray(idx.profiles) && idx.profiles.length) {
            // compat: s'assurer que default existe
            if (!idx.profiles.some(p => p.id === "default")) {
              idx.profiles.unshift({ id: "default", name: "Principal", storeKey: STORE_KEY, createdAt: nowISO(), updatedAt: nowISO() });
            }
            if (!idx.current) idx.current = "default";
            return idx;
          }
        }
      } catch (e) { console.warn("BFM: loadProfilesIndex error", e); }

      // Premier lancement (ou pas d'index) : on crée un profil "Principal".
      return {
        version: 1,
        current: "default",
        profiles: [{ id: "default", name: "Principal", storeKey: STORE_KEY, createdAt: nowISO(), updatedAt: nowISO() }]
      };
    }

    function saveProfilesIndex() {
      try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profilesIndex)); }
      catch (e) { console.warn("BFM: saveProfilesIndex error", e); }
    }

    function profileStoreKey(id) {
      if (id === "default") return STORE_KEY; // compat historique
      return `${STORE_KEY}__${id}`;
    }

    let profilesIndex = loadProfilesIndex();

    function getActiveProfile() {
      const id = profilesIndex.current || "default";
      return profilesIndex.profiles.find(p => p.id === id) || profilesIndex.profiles[0];
    }

    function getActiveStoreKey() {
      const p = getActiveProfile();
      return (p && p.storeKey) ? p.storeKey : STORE_KEY;
    }

    function touchProfile(id) {
      const p = profilesIndex.profiles.find(x => x.id === id);
      if (p) p.updatedAt = nowISO();
      saveProfilesIndex();
    }

    // Met à jour l'UI des profils (select + label). À appeler après création / import / switch.
    function refreshProfilesUI() {
      const sel = $("profile-select");
      const lab = $("profile-active-label");
      if (!sel) return;

      // Assurer l'intégrité de l'index profils
      if (!profilesIndex || !Array.isArray(profilesIndex.profiles) || profilesIndex.profiles.length === 0) {
        profilesIndex = loadProfilesIndex();
      }

      // Reconstruire options
      sel.innerHTML = "";
      for (const p of profilesIndex.profiles) {
        const opt = document.createElement("option");
        opt.value = String(p.id || "default");
        opt.textContent = p.name || (opt.value === "default" ? "Principal" : opt.value);
        sel.appendChild(opt);
      }

      const currentId = String(profilesIndex.current || "default");
      // Si l'id courant n'existe plus, retomber sur le premier
      const exists = profilesIndex.profiles.some(p => String(p.id) === currentId);
      const finalId = exists ? currentId : String(profilesIndex.profiles[0].id || "default");
      profilesIndex.current = finalId;
      saveProfilesIndex();

      sel.value = finalId;

      const active = profilesIndex.profiles.find(p => String(p.id) === finalId);
      if (lab) lab.textContent = active?.name || (finalId === "default" ? "Principal" : finalId);
    }





  const defaultState = () => ({
    version: 4,
    config: {
      activite: "",
      produitS: "produit",
      produitP: "produits",
      exemple: "",
      // Stock: autoriser un stock négatif (par défaut NON)
      allowNegativeStock: false
    },
    ingredients: [], // V4: {id,name,categorie,uniteCuisine,uniteStockageLabel,ratioConversion,stockMinimumBase,stockMaximumBase,lots:[...],pmpUnitBase,...}
    stockMovements: [], // V4: traçabilité (ENTREE, SORTIE, PERTE, INVENTAIRE)
    recipes: [],     // production batches
    packs: [],
    vendors: [],     // {id,name,commissionRaw}
    sales: [],       // {id,ts,date,time, ... , revenue, unitsSold, cogs}
    expenses: [],    // {id,date,cat,amount,note,ts}
    inventory: { finishedUnits: 0, finishedValue: 0 } // valeur au coût (COGS)
  });

function loadState(storeKey = getActiveStoreKey()) {
    try {
      const raw = localStorage.getItem(storeKey);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      // merge simple, keep unknown keys if any
      return {
        ...base,
        ...parsed,
        config: { ...base.config, ...(parsed.config || {}) },
        inventory: { ...base.inventory, ...(parsed.inventory || {}) },
        ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
        stockMovements: Array.isArray(parsed.stockMovements) ? parsed.stockMovements : [],
        recipes: Array.isArray(parsed.recipes) ? parsed.recipes : [],
        packs: Array.isArray(parsed.packs) ? parsed.packs : [],
        vendors: Array.isArray(parsed.vendors) ? parsed.vendors : [],
        sales: Array.isArray(parsed.sales) ? parsed.sales : [],
        expenses: Array.isArray(parsed.expenses) ? parsed.expenses : []
      };
    } catch (e) {
      console.warn("BFM: loadState error", e);
      return defaultState();
    }
  }

  function saveState(storeKey = getActiveStoreKey()) {
    try {
      localStorage.setItem(storeKey, JSON.stringify(state));
      touchProfile(getActiveProfile()?.id || "default");
    } catch (e) {
      console.warn("BFM: saveState error", e);
      toast("⚠️ Sauvegarde impossible (stockage plein ou navigateur).");
    }
  }

  let state = loadState();
  /* =========================
     0bis) Migration Stock PRO (V4)
     - Conserve tes anciennes données, mais les met au nouveau format (lots + mouvements)
  ========================== */

  function migrateStateToV4() {
    try {
      // config
      state.config = state.config || {};
      if (typeof state.config.allowNegativeStock !== "boolean") state.config.allowNegativeStock = false;

      if (!Array.isArray(state.stockMovements)) state.stockMovements = [];
      if (!Array.isArray(state.ingredients)) state.ingredients = [];

      const today = dateISO();

      for (const ing of state.ingredients) {
        if (!ing) continue;

        // Déjà en V4 ?
        if (Array.isArray(ing.lots)) {
          ing.categorie = ing.categorie || "Sec";
          ing.baseUnit = ing.baseUnit || unitToBaseQty(1, ing.uniteCuisine || ing.displayUnit || "g").baseUnit || "g";
          ing.uniteCuisine = ing.uniteCuisine || ing.displayUnit || baseUnitDefaultDisplay(ing.baseUnit);
          ing.displayUnit = ing.displayUnit || ing.uniteCuisine;
          if (ing.stockMinimumBase == null && ing.alertBaseQty != null) ing.stockMinimumBase = toNum(ing.alertBaseQty, 0);
          if (ing.stockMaximumBase == null) ing.stockMaximumBase = 0;
          if (ing.negativeBase == null) ing.negativeBase = 0;
          if (ing.pmpUnitBase == null) ing.pmpUnitBase = 0;

          ing.lots = ing.lots.map(l => ({
            idLot: l.idLot || uid(),
            dateEntree: l.dateEntree || today,
            dlc: l.dlc || "",
            quantiteInitialeBase: toNum(l.quantiteInitialeBase ?? l.quantiteInitiale ?? 0, 0),
            quantiteRestanteBase: toNum(l.quantiteRestanteBase ?? l.quantiteRestante ?? 0, 0),
            numeroLotFournisseur: safeText(l.numeroLotFournisseur || l.numeroLot || ""),
            prixAchatHTTotal: Math.round(toNum(l.prixAchatHTTotal ?? l.prixAchat ?? 0, 0)),
            fraisApprocheTotal: Math.round(toNum(l.fraisApprocheTotal ?? l.fraisApproche ?? 0, 0)),
            coutRenduUnitaireBase: toNum(l.coutRenduUnitaireBase ?? l.coutRenduUnitaire ?? 0, 0)
          }));
          continue;
        }

        // --- Migration depuis l'ancien format (V3) ---
        const baseUnit = ing.baseUnit || unitToBaseQty(1, ing.displayUnit || "g").baseUnit || "g";

        const qtyTotal = toNum(ing.baseQtyTotal, 0);
        const qtyRemaining = toNum(ing.baseQtyRemaining, 0);
        const priceTotal = Math.round(toNum(ing.priceTotal, 0));
        const unitCost = qtyTotal > 0 ? (priceTotal / qtyTotal) : 0;

        ing.categorie = "Sec";
        ing.baseUnit = baseUnit;
        ing.uniteCuisine = ing.displayUnit || baseUnitDefaultDisplay(baseUnit);
        ing.uniteStockageLabel = "";
        ing.ratioConversion = 0;

        ing.dernierPrixAchatHT = priceTotal;
        ing.fraisApproche = 0;
        ing.pmpUnitBase = unitCost;

        ing.stockMinimumBase = toNum(ing.alertBaseQty, 0);
        ing.stockMaximumBase = 0;
        ing.negativeBase = 0;

        ing.lots = [{
          idLot: uid(),
          dateEntree: today,
          dlc: "",
          quantiteInitialeBase: qtyTotal,
          quantiteRestanteBase: qtyRemaining,
          numeroLotFournisseur: "",
          prixAchatHTTotal: priceTotal,
          fraisApprocheTotal: 0,
          coutRenduUnitaireBase: unitCost
        }];
      }

      // Purge: lots terminés depuis plus de 6 mois
      purgeOldClosedLots(6);

      state.version = 4;
      saveState();
    } catch (e) {
      console.warn("BFM: migrateStateToV4 error", e);
    }
  }

  function purgeOldClosedLots(months = 6) {
    try {
      const limit = new Date();
      limit.setMonth(limit.getMonth() - Math.max(1, months));
      const limitMs = limit.getTime();

      for (const ing of (state.ingredients || [])) {
        if (!ing?.lots) continue;
        ing.lots = ing.lots.filter(l => {
          const rest = toNum(l.quantiteRestanteBase, 0);
          if (rest > 0) return true;
          const d = new Date(l.dateEntree || "");
          const ms = isNaN(d.getTime()) ? Date.now() : d.getTime();
          return ms >= limitMs; // on garde si pas assez vieux
        });
      }
    } catch (e) {
      console.warn("BFM: purgeOldClosedLots error", e);
    }
  }



  /* =========================
     1bis) Abonnement / Activation (device-wide)
     - Stocké hors profils (localStorage séparé)
     - Mode TEST optionnel
     - En cas d’expiration : mode lecture (consult + exports OK)
  ========================== */

  const SUBS_KEY = "BFM_SUBSCRIPTION_V1";
  


  function nowMs() { return Date.now(); }
  function toISODate(ms) { return new Date(ms).toISOString().slice(0,10); }

  function loadSubscription() {
    try {
      const raw = localStorage.getItem(SUBS_KEY);
      if (!raw) return { deviceId: "", activatedAt: 0, expiresAt: 0, lastCode: "", testUntil: 0 };
      const s = JSON.parse(raw);
      return {
        deviceId: String(s.deviceId || ""),
        activatedAt: toNum(s.activatedAt, 0),
        expiresAt: toNum(s.expiresAt, 0),
        lastCode: String(s.lastCode || ""),
        testUntil: toNum(s.testUntil, 0),
      };
    } catch {
      return { deviceId: "", activatedAt: 0, expiresAt: 0, lastCode: "", testUntil: 0 };
    }
  }

  function saveSubscription(sub) {
    try { localStorage.setItem(SUBS_KEY, JSON.stringify(sub)); }
    catch (e) { console.warn("BFM: saveSubscription", e); }
  }

  function ensureDeviceId(sub) {
    if (sub.deviceId) return sub.deviceId;
    // ID stable, non-personnel, pour support
    const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
    const stamp = new Date().toISOString().slice(0,10).replaceAll("-","");
    sub.deviceId = `BFM-${stamp}-${rand}`;
    saveSubscription(sub);
    return sub.deviceId;
  }

  // Parsing souple :
  // - Si le code contient YYYY-MM-DD => expiration ce jour-là
  // - Si le code contient D30 / D90 => durée en jours
  // - Sinon => 30 jours
  function activationToExpiresAt(code) {
    const c = String(code || "").trim().toUpperCase();
    const dateM = c.match(/(20\d{2})[-\/.](\d{2})[-\/.](\d{2})/);
    if (dateM) {
      const y = Number(dateM[1]), m = Number(dateM[2]), d = Number(dateM[3]);
      const dt = new Date(Date.UTC(y, m-1, d, 23, 59, 59));
      return dt.getTime();
    }
    const durM = c.match(/\bD(\d{1,3})\b/);
    const days = durM ? Math.max(1, Math.min(365, Number(durM[1]))) : 30;
    return nowMs() + days * 24 * 3600 * 1000;
  }

  function getSubscriptionStatus(sub) {
    const now = nowMs();
    const activeUntil = Math.max(toNum(sub.expiresAt, 0), toNum(sub.testUntil, 0));
    const active = activeUntil > now;
    const expiresAt = toNum(sub.expiresAt, 0);
    const test = toNum(sub.testUntil, 0) > now && expiresAt <= now; // test actif sans abo actif
    const daysLeft = activeUntil ? Math.ceil((activeUntil - now) / (24*3600*1000)) : 0;

    const graceDays = 14;
    const expired = expiresAt > 0 && expiresAt <= now;
    const expiredDays = expired ? Math.floor((now - expiresAt) / (24*3600*1000)) : 0;
    const inGrace = expired && expiredDays <= graceDays;

    return { active, activeUntil, expiresAt, test, daysLeft, expired, expiredDays, inGrace, graceDays };
  }

  // Mode lecture si pas actif
  let subscription = loadSubscription();
  ensureDeviceId(subscription);

  function isReadOnlyMode() {
    return !getSubscriptionStatus(subscription).active;
  }

  function applyReadOnlyToPage(pageName) {
    const status = getSubscriptionStatus(subscription);
    const page = $(`page-${pageName}`);
    if (!page) return;

    // Pages toujours autorisées
    const alwaysEditable = (pageName === "abonnement");
    const alwaysFree = (pageName === "home" || pageName === "dashboard" || pageName === "tutoriel" || pageName === "historique" || pageName === "mentionslegales" || pageName === "confidentialite" || pageName === "conditions");

    // Banner
    let banner = $("bfm-readonly-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "bfm-readonly-banner";
      banner.className = "readonly-banner hidden";
      banner.innerHTML = `
        <strong>Mode lecture</strong> — ajout/modification bloqués. 
        <span class="small" id="bfm-readonly-banner-detail"></span>
        <button class="btn btn-secondary" style="margin-left:10px;" type="button" onclick="showPage('abonnement')">🔐 Activer</button>
      `;
      document.body.appendChild(banner);
    }
    const detail = $("bfm-readonly-banner-detail");
    if (detail) {
      if (status.active) detail.textContent = "";
      else if (status.test) detail.textContent = `TEST en cours : ${status.daysLeft} jour(s) restant(s).`;
      else if (status.expiresAt > 0) detail.textContent = `Abonnement expiré${status.inGrace ? " (grâce)" : ""} : ${status.expiredDays} jour(s).`;
      else detail.textContent = `Aucun abonnement actif.`;
    }

    // Affichage bannière globale si lecture
    if (!status.active) banner.classList.remove("hidden");
    else banner.classList.add("hidden");

    // Si lecture : désactiver champs/boutons des pages "édition"
    document.body.classList.toggle("readonly", !status.active);

    if (alwaysFree || alwaysEditable) return;

    if (!status.active) {
      // disable controls within this page
      page.querySelectorAll("input, select, textarea, button").forEach(el => {
        // garder la navigation (hors page) et quelques boutons d'export si présents
        if (el.closest(".nav-links")) return;
        if (el.dataset && el.dataset.allowReadonly === "1") return;
        el.disabled = true;
      });
    } else {
      // réactiver
      page.querySelectorAll("input, select, textarea, button").forEach(el => {
        if (el.closest(".nav-links")) return;
        // ne pas toucher aux éléments explicitement désactivés dans le HTML
        if (el.hasAttribute("data-hard-disabled")) return;
        el.disabled = false;
      });
    }
  }

  function copyText(text) {
    const t = String(text || "");
    if (!t) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(() => toast("Copié ✅")).catch(() => {});
      return;
    }
    // fallback
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("Copié ✅"); } catch {}
    ta.remove();
  }

  function ensureSubscriptionUI() {
    const host = $("bfm-data-manager-host");
    if (!host) return;

    let existing = $("bfm-subscription-ui");
    if (existing) return; // already there

    const card = document.createElement("div");
    card.className = "card";
    card.id = "bfm-subscription-ui";
    card.style.marginTop = "14px";

    card.innerHTML = `
      <h2>Support & activation</h2>
      <p class="subtitle small" style="margin-bottom:10px;">
        Paiement via <strong>Orange Money</strong> ou <strong>MTN MoMo</strong> → envoie ton <strong>Device ID</strong> au support avec la preuve → reçois un <strong>code</strong> → colle-le ici puis <strong>Activer</strong>.
      </p>

      <div class="form-grid" style="align-items:end;">
        <div>
          <label>Device ID (support)</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <input id="sub-device-id" class="form-control" type="text" readonly />
            <button id="sub-copy-device" class="btn btn-secondary" type="button">📋 Copier</button>
          </div>
          <div class="small" style="opacity:.85;margin-top:6px;">
            Support : <strong>fotsiglobalservices@gmail.com</strong> — WhatsApp : <strong>+237 6 91 83 72 74</strong>
          </div>
        </div>

        <div>
          <label>Code d’activation</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <input id="sub-code" class="form-control" type="text" placeholder="Ex : BFM-D30-XXXX ou 2025-12-31-XXXX" />
            <button id="sub-activate" class="btn btn-primary" type="button">Activer</button>
          </div>
          <div class="small" style="opacity:.85;margin-top:6px;" id="sub-status">Statut : -</div>
        </div>

        <div>
          <label>Mode TEST</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button id="sub-start-test" class="btn btn-yellow" type="button">Démarrer TEST (7j)</button>
            <button id="sub-stop-test" class="btn btn-secondary" type="button">Arrêter TEST</button>
          </div>
          <div class="small" style="opacity:.85;margin-top:6px;">
            Le TEST sert à démontrer l’app : après expiration, l’app passe en <strong>mode lecture</strong> (exports OK).
          </div>
        </div>
      </div>
    `;

    // Insert above data manager block (host)
    host.parentElement.insertBefore(card, host);

    const dev = $("sub-device-id");
    const btnCopy = $("sub-copy-device");
    const inpCode = $("sub-code");
    const btnAct = $("sub-activate");
    const btnTest = $("sub-start-test");
    const btnStop = $("sub-stop-test");
    const statusEl = $("sub-status");

    function refreshSubUI() {
      const st = getSubscriptionStatus(subscription);
      if (dev) dev.value = subscription.deviceId || "";
      if (!statusEl) return;

      if (st.active && st.expiresAt > nowMs()) {
        statusEl.innerHTML = `Statut : <strong>ACTIF</strong> — expire le <strong>${toISODate(st.expiresAt)}</strong> (${st.daysLeft} jour(s)).`;
      } else if (st.test) {
        statusEl.innerHTML = `Statut : <strong>TEST</strong> — actif jusqu’au <strong>${toISODate(st.activeUntil)}</strong> (${st.daysLeft} jour(s)).`;
      } else if (st.expiresAt > 0) {
        statusEl.innerHTML = `Statut : <strong>EXPIRÉ</strong> — depuis ${st.expiredDays} jour(s)${st.inGrace ? ` (grâce ${st.graceDays}j)` : ""}.`;
      } else {
        statusEl.innerHTML = `Statut : <strong>INACTIF</strong> — mode lecture.`;
      }
    }

    if (btnCopy) btnCopy.addEventListener("click", () => copyText(subscription.deviceId));
   if (btnAct) btnAct.addEventListener("click", async () => {
  const code = safeText(inpCode?.value);
  if (!code) return toast("Code manquant.");

  // Option B : on accepte uniquement les codes signés BFM1....
  if (!code.startsWith(SUBS_PREFIX)) {
    return toast("Code invalide (format).");
  }

  const did = subscription.deviceId || ensureDeviceId(subscription);
  const res = await verifySignedActivationCode(code, did);

  if (!res.ok) {
    const msg =
      res.reason === "CRYPTO" ? "Activation impossible : navigateur incompatible (crypto)." :
      res.reason === "SIGNATURE" ? "Code invalide (signature)." :
      res.reason === "DEVICE" ? "Code invalide (mauvais appareil)." :
      res.reason === "DAYS" ? "Code invalide (durée)." :
      "Code invalide.";
    return toast(msg);
  }

  const days = Math.max(1, Math.min(3650, Math.floor(Number(res.payload.days))));
  const plan = safeText(res.payload.plan) || "PRO";

  subscription.lastCode = code;
  subscription.activatedAt = nowMs();
  subscription.expiresAt = nowMs() + days * 24 * 3600 * 1000;
  subscription.plan = plan;        // nouveau champ (OK, ça ne casse rien)
  subscription.testUntil = 0;      // activation > test
  saveSubscription(subscription);

  refreshSubUI();
  toast(`Activation OK ✅ (${days} jour(s) — ${plan})`);
  applyReadOnlyToPage(document.body.dataset.page || "home");
});


    if (btnTest) btnTest.addEventListener("click", () => {
      subscription.testUntil = nowMs() + 7 * 24 * 3600 * 1000;
      saveSubscription(subscription);
      refreshSubUI();
      toast("TEST démarré ✅");
      applyReadOnlyToPage(document.body.dataset.page || "home");
    });

    if (btnStop) btnStop.addEventListener("click", () => {
      subscription.testUntil = 0;
      saveSubscription(subscription);
      refreshSubUI();
      toast("TEST arrêté.");
      applyReadOnlyToPage(document.body.dataset.page || "home");
    });

    refreshSubUI();
  }

  // Normalisation (compat anciens états)
  (function normalizeState() {
    try {
      if (Array.isArray(state.recipes)) {
        state.recipes.forEach(r => {
          if (typeof r.remainingQty !== "number") r.remainingQty = toNum(r.producedQty, 0);
        });
      }
    } catch (e) { console.warn("BFM: normalizeState", e); }
  })();


  /* =========================
     2) Navigation (pages)
  ========================== */
  function hideAllPages() {
    $$(".page").forEach(p => p.classList.add("hidden"));
  }

  function setActiveTab(pageName) {
    $$(".nav-links button").forEach(b => b.classList.remove("active"));
    const tab = $(`tab-${pageName}`);
    if (tab) tab.classList.add("active");
  }

  function showPage(pageName) {
    document.body.dataset.page = pageName;
    hideAllPages();
    const page = $(`page-${pageName}`);
    if (page) page.classList.remove("hidden");
    setActiveTab(pageName);

    // rafraîchissements ciblés
    if (pageName === "ingredients") renderIngredients();
    if (pageName === "recettes") { ensureRecipeDeductUI(); refreshRecipeIngredientSelect(); renderRecipes(); }
    if (pageName === "packs") { refreshPackRecipeOptions(); renderPackDraft(); renderPacks(); refreshSalePackSelect(); updatePackEditUI(); }
    if (pageName === "ventes") { refreshVendorsSelect(); refreshSalePackSelect(); renderSalesOfDay(); }
    if (pageName === "depenses") renderExpenses();
    if (pageName === "dashboard") renderDashboard();
    if (pageName === "historique") renderHistorique();
    if (pageName === "config") { renderConfig(); ensureDataManagerUI(); }
    if (pageName === "abonnement") { ensureSubscriptionUI(); ensureDataManagerUI(); }
    applyReadOnlyToPage(pageName);
  }

  // Expose pour les onclick du HTML
  window.showPage = showPage;

  /* =========================
     3) Config
  ========================== */
  function renderConfig() {
    if ($("cfg-activite")) $("cfg-activite").value = state.config.activite || "";
    if ($("cfg-produit-s")) $("cfg-produit-s").value = state.config.produitS || "";
    if ($("cfg-produit-p")) $("cfg-produit-p").value = state.config.produitP || "";
    if ($("cfg-exemple")) $("cfg-exemple").value = state.config.exemple || "";
    if ($("cfg-allow-negative")) $("cfg-allow-negative").checked = !!state.config.allowNegativeStock;
  }

  function applyConfigLabels() {
    const pS = safeText(state.config.produitS) || "produit";
    const pP = safeText(state.config.produitP) || "produits";
    const brand = safeText(state.config.exemple) || "BusinessFood Manager";
    const titleEl = document.querySelector(".app-title");
    if (titleEl) titleEl.textContent = brand;
    try { document.title = brand ? `${brand} — BusinessFood Manager` : "BusinessFood Manager"; } catch {}


    if ($("label-dashboard-total")) $("label-dashboard-total").textContent = `Total ${pP} vendus`;
    if ($("label-dashboard-stock")) $("label-dashboard-stock").textContent = `Stock de ${pP} restants`;
    if ($("label-dashboard-capacite")) $("label-dashboard-capacite").textContent = `Capacité restante (${pP} possibles)`;

    if ($("dash-stock-restant")) $("dash-stock-restant").textContent = `${state.inventory.finishedUnits} ${pP}`;
  }
  function ensureDataManagerUI() {
      const host = $("bfm-data-manager-host");
      const page = host || $("page-config");
      if (!page) return;
      const existing = $("bfm-data-manager");
      if (existing) {
        // Si un "host" existe (page Abonnement), on y place le bloc pour éviter une page vide
        if (host && existing.parentElement !== host) host.appendChild(existing);
        refreshProfilesUI();
        return;
      }

      const card = document.createElement("div");
      card.className = "card";
      card.id = "bfm-data-manager";
      card.style.marginTop = "14px";
      card.innerHTML = `
        <h2>Gestion des données (sauvegarde / export / import)</h2>
        <p class="subtitle small" style="margin-bottom:10px;">
          Ici tu peux gérer plusieurs <strong>profils</strong> (plusieurs configurations complètes) et exporter/importer tes données.
          Chaque profil contient : config + ingrédients + recettes + packs + ventes + dépenses.
        </p>

        <div class="form-grid">
          <div>
            <label>Profil actif</label>
            <select id="profile-select"></select>
            <div class="small" style="opacity:.8;margin-top:-8px;">
              Actuel : <strong id="profile-active-label">-</strong>
            </div>
          </div>

          <div>
            <label>Actions profil</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary" id="btn-profile-new">➕ Nouveau</button>
              <button type="button" class="btn btn-secondary" id="btn-profile-dup">📌 Dupliquer</button>
              <button type="button" class="btn btn-secondary" id="btn-profile-rename">✏️ Renommer</button>
              <button type="button" class="btn btn-pink" id="btn-profile-delete">🗑️ Supprimer</button>
            </div>
          </div>

          <div>
            <label>Sauvegarde</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button type="button" class="btn btn-primary" id="btn-save-now">💾 Sauvegarder maintenant</button>
            </div>
            <div class="small" style="opacity:.8;margin-top:6px;">
              (L'app sauvegarde déjà automatiquement, mais ce bouton te donne un point de contrôle.)
            </div>
          </div>

          <div>
            <label>Export / Import (profil actif)</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary" id="btn-export-profile">⬇️ Export profil</button>
              <button type="button" class="btn btn-secondary" id="btn-import-profile">⬆️ Import profil</button>
            </div>
          </div>

          <div>
            <label>Export / Import (TOUT)</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary" id="btn-export-all">⬇️ Export TOUT</button>
              <button type="button" class="btn btn-secondary" id="btn-import-all">⬆️ Import TOUT</button>
            </div>
            <div class="small" style="opacity:.8;margin-top:6px;">
              Export TOUT = tous les profils dans un seul fichier. Import TOUT peut fusionner ou remplacer.
            </div>
          </div>
        </div>
      `;

      page.appendChild(card);

      // File inputs cachés (profil / bundle)
      const fileProfile = document.createElement("input");
      fileProfile.type = "file";
      fileProfile.accept = "application/json";
      fileProfile.id = "file-import-profile";
      fileProfile.style.display = "none";

      const fileAll = document.createElement("input");
      fileAll.type = "file";
      fileAll.accept = "application/json";
      fileAll.id = "file-import-all";
      fileAll.style.display = "none";

      page.appendChild(fileProfile);
      page.appendChild(fileAll);

      // Bind events
      on($("profile-select"), "change", (e) => switchProfile(String(e.target.value || "default")));
      on($("btn-profile-new"), "click", () => createProfile(false));
      on($("btn-profile-dup"), "click", () => createProfile(true));
      on($("btn-profile-rename"), "click", renameProfile);
      on($("btn-profile-delete"), "click", deleteProfile);

      on($("btn-save-now"), "click", () => { saveState(); toast("Sauvegarde effectuée ✅"); });

      on($("btn-export-profile"), "click", exportActiveProfile);
      on($("btn-import-profile"), "click", () => $("file-import-profile")?.click());
      on($("file-import-profile"), "change", importProfileFromFile);

      on($("btn-export-all"), "click", exportAllProfiles);
      on($("btn-import-all"), "click", () => $("file-import-all")?.click());
      on($("file-import-all"), "change", importAllFromFile);

      refreshProfilesUI();
    }

    function switchProfile(profileId) {
      const id = profileId || "default";
      if (id === (profilesIndex.current || "default")) return;

      // 1) Sauvegarder le profil actuel
      saveState();

      // 2) Switch
      profilesIndex.current = id;
      // s'assurer storeKey existe
      const p = profilesIndex.profiles.find(x => x.id === id);
      if (p) p.storeKey = profileStoreKey(p.id);
      saveProfilesIndex();

      // 3) Charger nouvel état
      state = loadState(profileStoreKey(id));
      // normaliser champs
      try {
        if (Array.isArray(state.recipes)) state.recipes.forEach(r => {
          if (typeof r.remainingQty !== "number") r.remainingQty = toNum(r.producedQty, 0);
        });
      } catch {}

      // reset UI
      initDefaults();
      refreshProfilesUI();
      showPage("home");
      toast(`Profil activé : ${getActiveProfile()?.name || "Principal"} ✅`);
    }

    function uniqueProfileName(baseName) {
      const base = safeText(baseName) || "Profil";
      let name = base;
      let n = 2;
      const exists = (nm) => profilesIndex.profiles.some(p => String(p.name).toLowerCase() === String(nm).toLowerCase());
      while (exists(name)) { name = `${base} (${n++})`; }
      return name;
    }

    function createProfile(cloneCurrent) {
      const wanted = prompt("Nom du nouveau profil :", cloneCurrent ? `Copie - ${getActiveProfile()?.name || "Principal"}` : "Nouveau profil");
      if (wanted == null) return;
      const name = uniqueProfileName(wanted);

      const id = uid();
      const storeKey = profileStoreKey(id);

      const newState = cloneCurrent ? JSON.parse(JSON.stringify(state)) : defaultState();
      // mettre une trace de version si besoin
      newState.version = 3;

      try { localStorage.setItem(storeKey, JSON.stringify(newState)); }
      catch (e) { console.warn("BFM: createProfile save error", e); return toast("Impossible de créer le profil (stockage plein ?)."); }

      profilesIndex.profiles.push({ id, name, storeKey, createdAt: nowISO(), updatedAt: nowISO() });
      profilesIndex.current = id;
      saveProfilesIndex();

      state = newState;
      initDefaults();
      ensureDataManagerUI();
      refreshProfilesUI();
      refreshProfilesUI();
      renderConfig();
      showPage("config");
      toast(`Profil créé : ${name} ✅`);
    }


    // -----------------------------
    // Stock Pro — MODE DÉMO (exemples)
    // -----------------------------
    function seedDemoStockProfile() {
      const baseName = "Démo Stock Pro";
      const existing = (profilesIndex.profiles || []).find(p => (p.name || "") === baseName);

      // Si déjà présent : soit on bascule, soit on réinitialise
      if (existing) {
        const reset = confirm(`Le profil "${baseName}" existe déjà.\n\nOK = Réinitialiser les données démo\nAnnuler = Juste basculer dessus`);
        profilesIndex.current = existing.id;
        saveProfilesIndex();

        if (reset) {
          const st = defaultState();
          fillDemoStockData(st);
          try { localStorage.setItem(existing.storeKey, JSON.stringify(st)); }
          catch (e) { console.warn("BFM: demo save error", e); return toast("Impossible d'écrire le profil démo (stockage plein ?)"); }
        }

        state = loadState(existing.storeKey);
        initDefaults();
        ensureDataManagerUI();
        refreshProfilesUI();
        renderConfig();
        showPage("ingredients");
        try { renderIngredients(); } catch (e) { console.error(e); }
        // Force refresh "Stock actuel" in case the UI is already on this page
        try { renderIngredients(); } catch (e) { console.error(e); }
        toast(`Profil démo chargé ✅`);
        return;
      }

      // Sinon : créer un nouveau profil démo (sans toucher au Principal)
      const id = uid();
      const storeKey = profileStoreKey(id);
      const name = baseName;

      const st = defaultState();
      fillDemoStockData(st);

      try { localStorage.setItem(storeKey, JSON.stringify(st)); }
      catch (e) { console.warn("BFM: demo create save error", e); return toast("Impossible de créer le profil démo (stockage plein ?)"); }

      profilesIndex.profiles.push({ id, name, storeKey, createdAt: nowISO(), updatedAt: nowISO() });
      profilesIndex.current = id;
      saveProfilesIndex();

      state = st;
      initDefaults();
      ensureDataManagerUI();
      refreshProfilesUI();
      renderConfig();
      showPage("ingredients");
      // Force refresh "Stock actuel" after seeding demo profile
      try { renderIngredients(); } catch (e) { console.error(e); }
      toast("Profil démo créé ✅");
    }

    function deleteDemoStockProfile() {
      const baseName = "Démo Stock Pro";
      const p = (profilesIndex.profiles || []).find(x => (x.name || "") === baseName);
      if (!p) return toast("Aucun profil Démo trouvé.");

      const ok = confirm(`Supprimer le profil "${baseName}" ?\n\n⚠️ Ça supprime aussi toutes ses données.`);
      if (!ok) return;

      // supprimer data
      try { localStorage.removeItem(profileStoreKey(p.id)); } catch {}

      // retirer index
      profilesIndex.profiles = (profilesIndex.profiles || []).filter(x => x.id !== p.id);
      if (!profilesIndex.profiles.length) {
        profilesIndex.profiles = [{ id: "default", name: "Principal", storeKey: STORE_KEY, createdAt: nowISO(), updatedAt: nowISO() }];
      }
      if (profilesIndex.current === p.id) profilesIndex.current = profilesIndex.profiles[0].id;
      saveProfilesIndex();

      // recharger profil courant
      state = loadState(getActiveStoreKey());
      initDefaults();
      ensureDataManagerUI();
      refreshProfilesUI();
      renderConfig();
      showPage("ingredients");
      toast("Profil démo supprimé ✅");
    }

    function fillDemoStockData(st) {
      // ⚠️ On prépare uniquement le stock pro (ingrédients + lots + mouvements)
      // Le but : montrer au restaurateur comment remplir + tester FIFO/DLC/pertes.
      st.config = st.config || {};
      st.config.activite = st.config.activite || "Démo - Stock alimentaire";
      st.config.produitS = st.config.produitS || "produit";
      st.config.produitP = st.config.produitP || "produits";

      st.ingredients = [];
      st.stockMovements = [];

      const today = new Date();
      const iso = (d) => {
        const x = new Date(d);
        const y = x.getFullYear();
        const m = String(x.getMonth() + 1).padStart(2, "0");
        const dd = String(x.getDate()).padStart(2, "0");
        return `${y}-${m}-${dd}`;
      };
      const addDays = (n) => {
        const d = new Date(today);
        d.setDate(d.getDate() + n);
        return d;
      };

      function mkIng({ name, categorie, uniteCuisine, uniteStockageLabel, ratio, stockMin, stockMax }) {
        const { baseQty: ratioBase, baseUnit } = unitToBaseQty(Math.max(0, toNum(ratio, 0)), uniteCuisine);
        const { baseQty: minBase } = unitToBaseQty(Math.max(0, toNum(stockMin, 0)), uniteCuisine);
        const { baseQty: maxBase } = unitToBaseQty(Math.max(0, toNum(stockMax, 0)), uniteCuisine);

        const ing = {
          id: uid(),
          name,
          categorie,
          baseUnit,
          uniteCuisine,
          displayUnit: uniteCuisine,
          uniteStockageLabel,
          ratioConversionBase: ratioBase || 0,
          stockMinimumBase: minBase || 0,
          stockMaximumBase: maxBase || 0,
          dernierPrixAchatHT: 0,
          fraisApproche: 0,
          pmpUnitBase: 0,
          negativeBase: 0,
          lots: []
        };
        st.ingredients.push(ing);
        return ing;
      }

      function mkLot(ing, { qty, unit, priceTotal, fraisTotal, dlc, dateEntree, num }) {
        const { baseQty, baseUnit } = unitToBaseQty(Math.max(0, toNum(qty, 0)), unit || ing.uniteCuisine);
        if (baseUnit !== ing.baseUnit) return; // incohérence unité, on ignore

        const price = Math.round(toNum(priceTotal, 0));
        const frais = Math.round(toNum(fraisTotal, 0));
        const unitCost = baseQty > 0 ? ((price + frais) / baseQty) : 0;

        const lot = {
          idLot: uid(),
          dateEntree: dateEntree || iso(today),
          dlc: dlc || "",
          quantiteInitialeBase: baseQty,
          quantiteRestanteBase: baseQty,
          numeroLotFournisseur: safeText(num || ""),
          prixAchatHTTotal: price,
          fraisApprocheTotal: frais,
          coutRenduUnitaireBase: unitCost
        };

        ing.lots.push(lot);

        // infos prix + PMP
        ing.dernierPrixAchatHT = price;
        ing.fraisApproche = frais;
        updateIngPmp(ing);

        // mouvement ENTREE
        st.stockMovements.push({
          id: uid(),
          ts: new Date().toISOString(),
          type: "ENTREE",
          ingredientId: ing.id,
          lotId: lot.idLot,
          qtyBase: baseQty,
          costTotal: (baseQty * unitCost),
          motif: "Réception (démo)",
          meta: { demo: true }
        });

        return lot;
      }

      function applyPerte(ing, lot, qty, unit, motif) {
        const { baseQty, baseUnit } = unitToBaseQty(Math.max(0, toNum(qty, 0)), unit || ing.uniteCuisine);
        if (baseUnit !== ing.baseUnit) return;

        const q = Math.min(baseQty, toNum(lot.quantiteRestanteBase, 0));
        if (q <= 0) return;

        lot.quantiteRestanteBase = toNum(lot.quantiteRestanteBase, 0) - q;
        updateIngPmp(ing);

        st.stockMovements.push({
          id: uid(),
          ts: new Date().toISOString(),
          type: "PERTE",
          ingredientId: ing.id,
          lotId: lot.idLot,
          qtyBase: q,
          costTotal: (q * toNum(lot.coutRenduUnitaireBase, 0)),
          motif: motif || "Perte (démo)",
          meta: { demo: true }
        });
      }

      // -----------------------------
      // Ingrédients (exemples réalistes)
      // -----------------------------

      // 1) Sec : Farine
      const farine = mkIng({
        name: "Farine (T55)",
        categorie: "Sec",
        uniteCuisine: "g",
        uniteStockageLabel: "Sac 25 kg",
        ratio: 25000,      // 1 sac = 25 000 g
        stockMin: 5000,    // alerte à 5 kg
        stockMax: 80000
      });
      mkLot(farine, { qty: 10000, unit: "g", priceTotal: 9000, fraisTotal: 1000, dlc: iso(addDays(180)), dateEntree: iso(addDays(-10)), num: "FAR-2401" });
      mkLot(farine, { qty: 25000, unit: "g", priceTotal: 22000, fraisTotal: 1500, dlc: iso(addDays(240)), dateEntree: iso(addDays(-2)), num: "FAR-2402" });

      // 2) Liquide : Lait
      const lait = mkIng({
        name: "Lait",
        categorie: "Liquide",
        uniteCuisine: "ml",
        uniteStockageLabel: "Brique 1 L",
        ratio: 1000,
        stockMin: 2000,
        stockMax: 20000
      });
      mkLot(lait, { qty: 12000, unit: "ml", priceTotal: 12000, fraisTotal: 800, dlc: iso(addDays(3)), dateEntree: iso(addDays(-1)), num: "LAI-8811" });

      // 3) Surgelé : Poisson (pour montrer "chaîne du froid")
      const poisson = mkIng({
        name: "Poisson (filets)",
        categorie: "Surgelé",
        uniteCuisine: "g",
        uniteStockageLabel: "Carton 5 kg",
        ratio: 5000,
        stockMin: 1500,
        stockMax: 20000
      });
      const lotPoisson = mkLot(poisson, { qty: 5000, unit: "g", priceTotal: 25000, fraisTotal: 2500, dlc: iso(addDays(30)), dateEntree: iso(addDays(-15)), num: "POI-7720" });

      // 4) Surgelé : Glace
      const glace = mkIng({
        name: "Glace (boules)",
        categorie: "Surgelé",
        uniteCuisine: "g",
        uniteStockageLabel: "Bac 2 kg",
        ratio: 2000,
        stockMin: 800,
        stockMax: 12000
      });
      mkLot(glace, { qty: 4000, unit: "g", priceTotal: 14000, fraisTotal: 1000, dlc: iso(addDays(20)), dateEntree: iso(addDays(-4)), num: "GLA-5502" });

      // 5) Frais : Ananas (DLC J-1 pour déclencher l'alerte)
      const ananas = mkIng({
        name: "Ananas",
        categorie: "Frais",
        uniteCuisine: "g",
        uniteStockageLabel: "Caisse 10 kg",
        ratio: 10000,
        stockMin: 1500,
        stockMax: 20000
      });
      mkLot(ananas, { qty: 4000, unit: "g", priceTotal: 6000, fraisTotal: 700, dlc: iso(addDays(1)), dateEntree: iso(addDays(-1)), num: "ANA-3301" });

      // 6) Frais : Mangue (DLC J-2)
      const mangue = mkIng({
        name: "Mangue",
        categorie: "Frais",
        uniteCuisine: "g",
        uniteStockageLabel: "Caisse 8 kg",
        ratio: 8000,
        stockMin: 1200,
        stockMax: 16000
      });
      mkLot(mangue, { qty: 3000, unit: "g", priceTotal: 6500, fraisTotal: 600, dlc: iso(addDays(2)), dateEntree: iso(addDays(-1)), num: "MAN-9021" });

      // 7) Frais : Carotte
      const carotte = mkIng({
        name: "Carotte",
        categorie: "Frais",
        uniteCuisine: "g",
        uniteStockageLabel: "Sac 5 kg",
        ratio: 5000,
        stockMin: 1000,
        stockMax: 12000
      });
      mkLot(carotte, { qty: 5000, unit: "g", priceTotal: 3500, fraisTotal: 500, dlc: iso(addDays(7)), dateEntree: iso(addDays(-2)), num: "CAR-1110" });

      // 8) Frais : Céleri
      const celeri = mkIng({
        name: "Céleri",
        categorie: "Frais",
        uniteCuisine: "g",
        uniteStockageLabel: "Botte 1 kg",
        ratio: 1000,
        stockMin: 300,
        stockMax: 6000
      });
      mkLot(celeri, { qty: 1500, unit: "g", priceTotal: 2000, fraisTotal: 300, dlc: iso(addDays(5)), dateEntree: iso(addDays(-1)), num: "CEL-7712" });

      // Démo "coupure de courant" : on déclare une PERTE sur le poisson (2 kg jetés)
      if (lotPoisson) {
        applyPerte(poisson, lotPoisson, 2000, "g", "Coupure de courant (chaîne du froid rompue)");
      }

      // Nettoyage/optim (au cas où)
      purgeOldClosedLots(6);
    }


    function renameProfile() {
      const p = getActiveProfile();
      if (!p) return;
      const wanted = prompt("Nouveau nom du profil :", p.name);
      if (wanted == null) return;
      p.name = uniqueProfileName(wanted);
      touchProfile(p.id);
      refreshProfilesUI();
      toast("Profil renommé ✅");
    }

    function deleteProfile() {
      const p = getActiveProfile();
      if (!p) return;

      if (p.id === "default" && profilesIndex.profiles.length === 1) {
        return toast("Impossible : il faut garder au moins un profil.");
      }

      const ok = confirm(`Supprimer le profil "${p.name}" ?\n\n⚠️ Ça supprime aussi toutes ses données.`);
      if (!ok) return;

      // supprimer data key
      try { localStorage.removeItem(profileStoreKey(p.id)); } catch {}

      // retirer index
      profilesIndex.profiles = profilesIndex.profiles.filter(x => x.id !== p.id);
      if (!profilesIndex.profiles.length) {
        profilesIndex.profiles = [{ id: "default", name: "Principal", storeKey: STORE_KEY, createdAt: nowISO(), updatedAt: nowISO() }];
      }
      profilesIndex.current = profilesIndex.profiles[0].id;
      saveProfilesIndex();

      // charger profil restant
      state = loadState(profileStoreKey(profilesIndex.current));
      initDefaults();
      refreshProfilesUI();
      renderConfig();
      showPage("config");

      toast("Profil supprimé.");
    }

    function exportActiveProfile() {
      const p = getActiveProfile();
      if (!p) return;

      // sauvegarder avant export
      saveState();

      const payload = {
        kind: "BFM_PROFILE",
        version: 1,
        exportedAt: nowISO(),
        profile: { id: p.id, name: p.name },
        state
      };
      const filename = `BFM_profil_${p.name.replace(/[^a-z0-9_-]+/gi,"_")}_${dateISO()}.json`;
      downloadText(filename, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
      toast("Export profil OK ✅");
    }

    function exportAllProfiles() {
      // sauvegarder profil actif
      saveState();

      const bundle = {
        kind: "BFM_BUNDLE",
        version: 1,
        exportedAt: nowISO(),
        current: profilesIndex.current || "default",
        profiles: profilesIndex.profiles.map(p => {
          const k = profileStoreKey(p.id);
          let st = null;
          try {
            const raw = localStorage.getItem(k);
            st = raw ? JSON.parse(raw) : null;
          } catch { st = null; }
          return { id: p.id, name: p.name, state: st || defaultState() };
        })
      };

      const filename = `BFM_TOUT_${dateISO()}.json`;
      downloadText(filename, JSON.stringify(bundle, null, 2), "application/json;charset=utf-8");
      toast("Export TOUT OK ✅");
    }

    function readJsonFile(file, cb) {
      const reader = new FileReader();
      reader.onload = () => {
        try { cb(JSON.parse(String(reader.result || "{}"))); }
        catch { toast("Fichier JSON invalide."); }
      };
      reader.readAsText(file);
    }

    function importProfileFromFile(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;

      readJsonFile(file, (data) => {
        if (!data || data.kind !== "BFM_PROFILE" || !data.state) {
          return toast("Ce fichier n'est pas un export de profil BusinessFood Manager.");
        }

        const importedName = safeText(data.profile?.name) || "Profil importé";
        const name = uniqueProfileName(importedName);

        const id = uid();
        const storeKey = profileStoreKey(id);

        try { localStorage.setItem(storeKey, JSON.stringify(data.state)); }
        catch (e) { console.warn("BFM: import profile save", e); return toast("Import impossible (stockage plein ?)."); }

        profilesIndex.profiles.push({ id, name, storeKey, createdAt: nowISO(), updatedAt: nowISO() });
        profilesIndex.current = id;
        saveProfilesIndex();

        state = loadState(storeKey);
        initDefaults();
        refreshProfilesUI();
        showPage("home");
        toast(`Profil importé : ${name} ✅`);
      });
    }

    function importAllFromFile(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;

      readJsonFile(file, (data) => {
        if (!data || data.kind !== "BFM_BUNDLE" || !Array.isArray(data.profiles)) {
          return toast("Ce fichier n'est pas un export complet BusinessFood Manager.");
        }

        const replaceAll = confirm("Importer TOUT :\nOK = Fusionner avec tes profils actuels\nAnnuler = arrêter\n\n(Option remplacement total : on te le proposera ensuite)");
        if (!replaceAll) return;

        const doReplace = confirm("Souhaites-tu REMPLACER totalement tes profils existants ?\n\nOK = Remplacer tout (⚠️ destructif)\nAnnuler = Fusionner (recommandé)");

        if (doReplace) {
          // supprimer anciennes clés
          try {
            profilesIndex.profiles.forEach(p => localStorage.removeItem(profileStoreKey(p.id)));
          } catch {}
          profilesIndex = { version: 1, current: "default", profiles: [] };
        }

        // importer profils
        for (const p of data.profiles) {
          const name = uniqueProfileName(p.name || "Profil importé");
          const id = uid();
          const storeKey = profileStoreKey(id);
          const st = p.state || defaultState();
          try { localStorage.setItem(storeKey, JSON.stringify(st)); }
          catch { toast("Import partiel: stockage plein."); break; }
          profilesIndex.profiles.push({ id, name, storeKey, createdAt: nowISO(), updatedAt: nowISO() });
        }

        if (!profilesIndex.profiles.length) {
          profilesIndex.profiles = [{ id: "default", name: "Principal", storeKey: STORE_KEY, createdAt: nowISO(), updatedAt: nowISO() }];
          profilesIndex.current = "default";
        } else {
          profilesIndex.current = profilesIndex.profiles[0].id;
        }

        saveProfilesIndex();

        state = loadState(profileStoreKey(profilesIndex.current));
        initDefaults();
        refreshProfilesUI();
        showPage("home");
        toast("Import TOUT terminé ✅");
      });
    }



  


  function saveConfig() {
    state.config.activite = safeText($("cfg-activite")?.value);
    state.config.produitS = safeText($("cfg-produit-s")?.value) || "produit";
    state.config.produitP = safeText($("cfg-produit-p")?.value) || "produits";
    state.config.exemple  = safeText($("cfg-exemple")?.value);

    saveState();
    applyConfigLabels();
    // retour accueil
    showPage("home");
    toast("Configuration enregistrée ✅");
  }

  /* =========================
     4) Toast (mini feedback)
  ========================== */
  function toast(msg) {
    // Simple toast sans CSS dédié: on réutilise alert si pas de style
    // (on fera mieux dans le CSS plus tard)
    try {
      const t = el("div", { class: "bfm-toast", style: "position:fixed;bottom:14px;left:14px;right:14px;z-index:9999;padding:12px 14px;border-radius:12px;background:rgba(0,0,0,.85);color:#fff;font-family:system-ui;max-width:520px;margin:auto;box-shadow:0 10px 30px rgba(0,0,0,.3);" }, [msg]);
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2200);
    } catch {
      alert(msg);
    }
  }

  /* =========================
     5) Ingrédients
  ========================== */
  
  /* =========================
     5) Ingrédients — Stock PRO (V4)
     - Lots + DLC + FIFO + Traçabilité + Valorisation
  ========================== */

  function ingLots(ing) {
    if (!ing.lots) ing.lots = [];
    return ing.lots;
  }

  function ingRemainingBase(ing) {
    const lots = ingLots(ing);
    const sumLots = lots.reduce((s, l) => s + toNum(l.quantiteRestanteBase, 0), 0);
    const neg = toNum(ing.negativeBase, 0);
    return sumLots - neg; // peut être négatif si autorisé
  }

  function ingRemainingLotsBase(ing) {
    return ingLots(ing).reduce((s, l) => s + toNum(l.quantiteRestanteBase, 0), 0);
  }

  function ingTotalValue(ing) {
    // Valeur au coût rendu (landed cost) sur les quantités RESTANTES
    const lots = ingLots(ing);
    const v = lots.reduce((s, l) => s + (toNum(l.quantiteRestanteBase, 0) * toNum(l.coutRenduUnitaireBase, 0)), 0);
    return Math.max(0, v);
  }

  function ingPmpUnitBase(ing) {
    // Prix moyen pondéré (sur stock restant)
    const qty = ingRemainingLotsBase(ing);
    const v = ingTotalValue(ing);
    if (qty > 0) return v / qty;
    // fallback
    return toNum(ing.pmpUnitBase, 0) || 0;
  }

  function updateIngPmp(ing) {
    ing.pmpUnitBase = ingPmpUnitBase(ing);
  }

  function pricePerBaseUnit(ing) {
    // Compat avec l'ancien code : renvoie le coût unitaire en "baseUnit" (g/ml/pièce)
    return ingPmpUnitBase(ing);
  }

  function ingredientStockValue(ing) {
    return ingTotalValue(ing);
  }


  function ingDisplayUnit(ing) {
    return ing.displayUnit || ing.uniteCuisine || baseUnitDefaultDisplay(ing.baseUnit || "g");
  }
// Fonction d'arrondi intelligent
function roundSmart(n, decimals = 2) {
  if (n === 0) return 0;
  if (Math.abs(n) >= 100) return Math.round(n);
  if (Math.abs(n) >= 10) return Math.round(n * 10) / 10;
  return Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

  function ingredientDisplayQty(baseQty, ing) {
    const displayUnit = ingDisplayUnit(ing);
    const display = baseQtyToDisplay(baseQty, ing.baseUnit, displayUnit);
    return `${roundSmart(display)} ${displayUnit}`;
  }

  function ingredientDisplayRemaining(ing) {
    return ingredientDisplayQty(ingRemainingBase(ing), ing);
  }

  function ingredientDisplayRemainingLotsOnly(ing) {
    return ingredientDisplayQty(ingRemainingLotsBase(ing), ing);
  }

  function ingredientDisplayMin(ing) {
    const v = toNum(ing.stockMinimumBase ?? ing.alertBaseQty ?? 0, 0);
    if (v <= 0) return "—";
    return ingredientDisplayQty(v, ing);
  }

  function ingredientDisplayMax(ing) {
    const v = toNum(ing.stockMaximumBase ?? 0, 0);
    if (v <= 0) return "—";
    return ingredientDisplayQty(v, ing);
  }

  function recordStockMovement({ type, ingredientId, lotId = null, qtyBase = 0, costTotal = 0, motif = "", meta = {} }) {
    if (!Array.isArray(state.stockMovements)) state.stockMovements = [];
    state.stockMovements.push({
      id: uid(),
      ts: new Date().toISOString(),
      type,
      ingredientId,
      lotId,
      qtyBase: toNum(qtyBase, 0),
      costTotal: toNum(costTotal, 0),
      motif: safeText(motif || ""),
      meta
    });
  }

  function addStockLot(ingredientId, { qtyBase, priceHTTotal = 0, fraisApprocheTotal = 0, dlc = "", numeroLotFournisseur = "", dateEntree = dateISO() }, motif = "Réception") {
    const ing = state.ingredients.find(i => i.id === ingredientId);
    if (!ing) return toast("Ingrédient introuvable.");

    qtyBase = toNum(qtyBase, 0);
    if (qtyBase <= 0) return toast("Quantité invalide.");

    const price = Math.round(toNum(priceHTTotal, 0));
    const frais = Math.round(toNum(fraisApprocheTotal, 0));
    const unitCost = qtyBase > 0 ? ((price + frais) / qtyBase) : 0;

    // Compensation du stock négatif éventuel
    const neg = Math.max(0, toNum(ing.negativeBase, 0));
    const offset = Math.min(neg, qtyBase);

    const lot = {
      idLot: uid(),
      dateEntree: dateEntree || dateISO(),
      dlc: dlc || "",
      quantiteInitialeBase: qtyBase,
      quantiteRestanteBase: qtyBase - offset,
      numeroLotFournisseur: safeText(numeroLotFournisseur || ""),
      prixAchatHTTotal: price,
      fraisApprocheTotal: frais,
      coutRenduUnitaireBase: unitCost
    };

    ingLots(ing).push(lot);

    // Mouvements
    recordStockMovement({ type: "ENTREE", ingredientId: ing.id, lotId: lot.idLot, qtyBase, costTotal: (qtyBase * unitCost), motif });

    if (offset > 0) {
      ing.negativeBase = neg - offset;
      recordStockMovement({ type: "SORTIE", ingredientId: ing.id, lotId: lot.idLot, qtyBase: offset, costTotal: (offset * unitCost), motif: "Compensation stock négatif" });
    }

    // MAJ infos prix
    ing.dernierPrixAchatHT = price;
    ing.fraisApproche = frais;
    updateIngPmp(ing);

    purgeOldClosedLots(6);
    saveState();
    renderIngredients();
    refreshRecipeIngredientSelect();
    toast("Lot ajouté ✅");
  }

  function lotsSortedForFifo(ing) {
    const lots = [...ingLots(ing)];
    // FIFO via DLC la plus proche, puis date d'entrée
    lots.sort((a, b) => {
      const ad = a.dlc ? new Date(a.dlc).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.dlc ? new Date(b.dlc).getTime() : Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;
      const ae = new Date(a.dateEntree || "").getTime();
      const be = new Date(b.dateEntree || "").getTime();
      return (isNaN(ae) ? 0 : ae) - (isNaN(be) ? 0 : be);
    });
    return lots;
  }

  function consumeFIFO(ingredientId, qtyBase, { type = "SORTIE", motif = "Sortie", meta = {} } = {}) {
    const ing = state.ingredients.find(i => i.id === ingredientId);
    if (!ing) return { ok: false, msg: "Ingrédient introuvable." };

    qtyBase = toNum(qtyBase, 0);
    if (qtyBase <= 0) return { ok: false, msg: "Quantité invalide." };

    const allowNeg = !!state.config.allowNegativeStock;

    // Pré-check si stock négatif interdit
    if (!allowNeg && ingRemainingLotsBase(ing) < qtyBase - 1e-9) {
      return { ok: false, msg: `Stock insuffisant pour ${ing.name} (restant ${ingredientDisplayRemainingLotsOnly(ing)})` };
    }

    let need = qtyBase;
    let costTotal = 0;
    const breakdown = [];

    const fifo = lotsSortedForFifo(ing).filter(l => toNum(l.quantiteRestanteBase, 0) > 0);

    for (const lot of fifo) {
      if (need <= 0) break;
      const avail = toNum(lot.quantiteRestanteBase, 0);
      if (avail <= 0) continue;

      const take = Math.min(avail, need);
      lot.quantiteRestanteBase = avail - take;

      const unitCost = toNum(lot.coutRenduUnitaireBase, 0);
      const cost = take * unitCost;
      costTotal += cost;

      breakdown.push({
        idLot: lot.idLot,
        qtyBase: take,
        dlc: lot.dlc || "",
        numeroLotFournisseur: lot.numeroLotFournisseur || "",
        coutRenduUnitaireBase: unitCost
      });

      recordStockMovement({ type, ingredientId: ing.id, lotId: lot.idLot, qtyBase: take, costTotal: cost, motif, meta });

      need -= take;
    }

    // Si manque et autorisé => stock négatif
    if (need > 0) {
      if (allowNeg) {
        const unitCost = ingPmpUnitBase(ing);
        const cost = need * unitCost;
        costTotal += cost;
        ing.negativeBase = Math.max(0, toNum(ing.negativeBase, 0)) + need;

        breakdown.push({
          idLot: null,
          qtyBase: need,
          dlc: "",
          numeroLotFournisseur: "",
          coutRenduUnitaireBase: unitCost
        });

        recordStockMovement({ type, ingredientId: ing.id, lotId: null, qtyBase: need, costTotal: cost, motif: `${motif} (stock négatif)`, meta });
        need = 0;
      } else {
        return { ok: false, msg: "Stock insuffisant." };
      }
    }

    updateIngPmp(ing);
    purgeOldClosedLots(6);
    saveState();
    return { ok: true, costTotal, breakdown };
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    // normaliser en dates
    const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const nn = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.round((dd - nn) / 86400000);
  }

  function ingredientHealthStatus(ing) {
    // combine: rupture (qty) + urgence DLC
    const remLots = ingRemainingLotsBase(ing);
    const min = toNum(ing.stockMinimumBase ?? ing.alertBaseQty ?? 0, 0);
    const qtyLevel = (min > 0 && remLots <= min + 1e-9) ? "red" : (min > 0 && remLots <= min * 1.3 ? "orange" : "green");

    const soonest = nearestExpiringLot(ing);
    let dlcLevel = "green";
    if (soonest && soonest.days != null) {
      if (soonest.days <= 1) dlcLevel = "red";
      else if (soonest.days <= 2) dlcLevel = "orange";
    }

    // worst color wins
    const rank = { green: 0, orange: 1, red: 2 };
    return (rank[dlcLevel] > rank[qtyLevel]) ? dlcLevel : qtyLevel;
  }

  function nearestExpiringLot(ing) {
    const active = ingLots(ing).filter(l => toNum(l.quantiteRestanteBase, 0) > 0 && l.dlc);
    if (!active.length) return null;
    active.sort((a, b) => new Date(a.dlc).getTime() - new Date(b.dlc).getTime());
    const l = active[0];
    return { ...l, days: daysUntil(l.dlc) };
  }

  function addIngredient() {
    // Fiche ingrédient + (optionnel) 1er lot
    const name = safeText($("ing-nom")?.value);
    const categorie = $("ing-cat")?.value || "Sec";
    const uniteCuisine = $("ing-unite-cuisine")?.value || ($("ing-unit")?.value || "g"); // compat
    const uniteStockageLabel = safeText($("ing-unite-stockage")?.value || "");
    const ratioConv = toNum($("ing-ratio")?.value, 0); // en unité cuisine => converti en base
    const stockMin = toNum($("ing-min")?.value ?? $("ing-seuil")?.value, 0); // compat
    const stockMax = toNum($("ing-max")?.value, 0);

    if (!name) return toast("Nom ingrédient manquant.");

    const { baseQty: ratioBase, baseUnit } = unitToBaseQty(Math.max(0, ratioConv), uniteCuisine);
    const { baseQty: minBase } = unitToBaseQty(Math.max(0, stockMin), uniteCuisine);
    const { baseQty: maxBase } = unitToBaseQty(Math.max(0, stockMax), uniteCuisine);

    // Bloquer doublon exact (même nom)
    const exists = state.ingredients.some(i => String(i.name).toLowerCase() === String(name).toLowerCase());
    if (exists && !confirm("Un ingrédient avec ce nom existe déjà. Créer quand même ?")) return;

    const ing = {
      id: uid(),
      name,
      categorie,
      baseUnit,
      uniteCuisine: uniteCuisine,
      displayUnit: uniteCuisine,
      uniteStockageLabel,
      ratioConversionBase: ratioBase || 0,
      stockMinimumBase: minBase || 0,
      stockMaximumBase: maxBase || 0,
      dernierPrixAchatHT: 0,
      fraisApproche: 0,
      pmpUnitBase: 0,
      negativeBase: 0,
      lots: []
    };

    state.ingredients.push(ing);

    // Optionnel: créer le 1er lot à partir du formulaire "Réception"
    const lotQty = toNum($("lot-qt")?.value ?? $("ing-qt")?.value, 0);
    const lotUnit = $("lot-unit")?.value || uniteCuisine;
    const lotPrix = toNum($("lot-prix")?.value ?? $("ing-prix")?.value, 0);
    const lotFrais = toNum($("lot-frais")?.value, 0);
    const lotDlc = $("lot-dlc")?.value || "";
    const lotNum = safeText($("lot-num")?.value || "");
    const lotDateEntree = $("lot-date")?.value || dateISO();

    if (lotQty > 0) {
      const { baseQty, baseUnit: lotBaseUnit } = unitToBaseQty(lotQty, lotUnit);
      if (lotBaseUnit !== ing.baseUnit) {
        // Ex: tu saisis kg sur un ingrédient liquide en ml (ou l'inverse)
        state.ingredients = state.ingredients.filter(x => x.id !== ing.id);
        return toast(`Unité incohérente pour le lot : ${lotUnit} n'est pas compatible avec ${ing.baseUnit}.`);
      }
      // Ajout lot
      const price = Math.round(toNum(lotPrix, 0));
      const frais = Math.round(toNum(lotFrais, 0));
      const unitCost = baseQty > 0 ? ((price + frais) / baseQty) : 0;

      const lot = {
        idLot: uid(),
        dateEntree: lotDateEntree,
        dlc: lotDlc,
        quantiteInitialeBase: baseQty,
        quantiteRestanteBase: baseQty,
        numeroLotFournisseur: lotNum,
        prixAchatHTTotal: price,
        fraisApprocheTotal: frais,
        coutRenduUnitaireBase: unitCost
      };

      ing.lots.push(lot);
      recordStockMovement({ type: "ENTREE", ingredientId: ing.id, lotId: lot.idLot, qtyBase: baseQty, costTotal: baseQty * unitCost, motif: "Création ingrédient (lot initial)" });

      ing.dernierPrixAchatHT = price;
      ing.fraisApproche = frais;
      updateIngPmp(ing);
    }

    // reset form
    ["ing-nom","ing-unite-stockage","ing-ratio","ing-min","ing-max","ing-prix","ing-qt","ing-seuil","lot-qt","lot-prix","lot-frais","lot-dlc","lot-num"].forEach(id => { if ($(id)) $(id).value = ""; });

    saveState();
    renderIngredients();
    refreshRecipeIngredientSelect();
    renderStockSummary();
    if (lotQty > 0) toast("Ingrédient + lot enregistrés ✅");
    else toast("Fiche ingrédient créée ✅ (stock = 0 : pense à ajouter une réception)");
  }

  function editIngredient(id) {
    const ing = state.ingredients.find(i => i.id === id);
    if (!ing) return;

    const name = prompt("Nom de l'ingrédient :", ing.name);
    if (name == null) return;

    const categorie = prompt("Catégorie (Sec/Frais/Surgelé/Liquide) :", ing.categorie || "Sec");
    if (categorie == null) return;

    const minDisplay = baseQtyToDisplay(toNum(ing.stockMinimumBase ?? 0,0), ing.baseUnit, ingDisplayUnit(ing));
    const min = prompt(`Stock minimum (${ingDisplayUnit(ing)}) :`, String(minDisplay));
    if (min == null) return;

    const maxDisplay = baseQtyToDisplay(toNum(ing.stockMaximumBase ?? 0,0), ing.baseUnit, ingDisplayUnit(ing));
    const max = prompt(`Stock maximum (${ingDisplayUnit(ing)}) :`, String(maxDisplay));
    if (max == null) return;

    ing.name = safeText(name) || ing.name;
    ing.categorie = safeText(categorie) || ing.categorie || "Sec";

    const { baseQty: minBase } = unitToBaseQty(Math.max(0, toNum(min, 0)), ingDisplayUnit(ing));
    const { baseQty: maxBase } = unitToBaseQty(Math.max(0, toNum(max, 0)), ingDisplayUnit(ing));
    ing.stockMinimumBase = minBase;
    ing.stockMaximumBase = maxBase;

    saveState();
    renderIngredients();
    refreshRecipeIngredientSelect();
    renderStockSummary();
    toast("Ingrédient modifié ✅");
  }

  function deleteIngredient(id) {
    const usedInRecipes = state.recipes.some(r => (r.ingredients || []).some(x => x.ingredientId === id));
    if (usedInRecipes) {
      if (!confirm("Cet ingrédient apparaît dans des recettes enregistrées. Le supprimer va rendre l'historique moins clair. Continuer ?")) return;
    }
    state.ingredients = state.ingredients.filter(i => i.id !== id);
    // movements purge (optionnel)
    if (Array.isArray(state.stockMovements)) {
      state.stockMovements = state.stockMovements.filter(m => m.ingredientId !== id);
    }
    saveState();
    renderIngredients();
    refreshRecipeIngredientSelect();
    renderStockSummary();
    toast("Ingrédient supprimé.");
  }

  function renderStockSummary() {
    const box = $("stock-summary");
    if (!box) return;

    const ings = state.ingredients || [];
    const totalValue = ings.reduce((s, ing) => s + ingTotalValue(ing), 0);
    const lowCount = ings.filter(ing => {
      const min = toNum(ing.stockMinimumBase ?? ing.alertBaseQty ?? 0,0);
      return min > 0 && ingRemainingLotsBase(ing) <= min + 1e-9;
    }).length;

    // Gaspillage (PERTE) mois en cours
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const wasteCost = (state.stockMovements || []).filter(x => x.type === "PERTE").reduce((s, x) => {
      const d = new Date(x.ts || "");
      if (isNaN(d.getTime())) return s;
      if (d.getFullYear() !== y || d.getMonth() !== m) return s;
      return s + toNum(x.costTotal, 0);
    }, 0);


    // DLC J-2 et J-1
    let j2 = 0, j1 = 0;
    for (const ing of ings) {
      for (const lot of ingLots(ing)) {
        if (toNum(lot.quantiteRestanteBase,0) <= 0) continue;
        const d = daysUntil(lot.dlc || "");
        if (d == null) continue;
        if (d <= 1) j1 += 1;
        else if (d === 2) j2 += 1;
      }
    }

    box.innerHTML = `
      <div class="dashboard-grid" style="margin-top:10px;">
        <div class="dash-card"><h3>Valeur stock</h3><p>${money(totalValue)}</p></div>
        <div class="dash-card"><h3>Ruptures</h3><p>${lowCount}</p></div>
        <div class="dash-card"><h3>DLC J-1</h3><p>${j1}</p></div>
        <div class="dash-card"><h3>DLC J-2</h3><p>${j2}</p></div>
        <div class="dash-card"><h3>Gaspillage (mois)</h3><p>${money(wasteCost)}</p></div>
      </div>
      <div class="small" style="opacity:.85;margin-top:8px;">
        FIFO = lots consommés d'abord avec la DLC la plus proche. Traçabilité via mouvements (ENTREE/SORTIE/PERTE/INVENTAIRE).
      </div>
    `;
  }

  function exportTraceabilityCSV(fromISO, toISO) {
    const from = fromISO ? new Date(fromISO) : null;
    const to = toISO ? new Date(toISO) : null;

    // On exporte la traçabilité des PRODUCTIONS (recettes enregistrées)
    const rows = [];
    rows.push(["dateProduction","recette","ingredient","lotId","numeroLotFournisseur","dlc","qtyBase","uniteBase"].join(";"));

    for (const r of (state.recipes || [])) {
      const d = new Date(r.createdAt || r.ts || "");
      if (from && d < from) continue;
      if (to) {
        const toEnd = new Date(to); toEnd.setHours(23,59,59,999);
        if (d > toEnd) continue;
      }

      for (const it of (r.ingredients || [])) {
        const ing = state.ingredients.find(x => x.id === it.ingredientId);
        const baseUnit = ing?.baseUnit || "g";
        const lots = Array.isArray(it.lotBreakdown) ? it.lotBreakdown : [];
        if (!lots.length) {
          rows.push([safeText(r.createdAt||""), safeText(r.name||""), safeText(it.name||""), "ND", "ND", "ND", String(toNum(it.baseQty,0)), baseUnit].join(";"));
        } else {
          for (const b of lots) {
            rows.push([
              safeText(r.createdAt||""),
              safeText(r.name||""),
              safeText(it.name||""),
              safeText(b.idLot || "ND"),
              safeText(b.numeroLotFournisseur || "ND"),
              safeText(b.dlc || "ND"),
              String(toNum(b.qtyBase,0)),
              baseUnit
            ].join(";"));
          }
        }
      }
    }

    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `BFM-tracabilite_${fromISO||"debut"}_${toISO||"fin"}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  function renderIngredients() {
    const container = getIngredientsListContainer();
    if (!container) { console.warn("BFM: ingredients list container not found"); return; }

    try {

    renderStockSummary();

    if (!state.ingredients.length) {
      container.innerHTML = "<em>Aucun ingrédient enregistré.</em>";
      return;
    }

    const wrapper = el("div", { class: "bfm-list" });

    // tri : statut (rouge/orange/vert) puis alpha
    const rank = { red: 0, orange: 1, green: 2 };
    const list = [...state.ingredients].sort((a, b) => {
      const sa = ingredientHealthStatus(a);
      const sb = ingredientHealthStatus(b);
      if (sa !== sb) return rank[sa] - rank[sb];
      return String(a.name).localeCompare(String(b.name), "fr");
    });

    for (const ing of list) {
      updateIngPmp(ing);
      const status = ingredientHealthStatus(ing);
      const remLots = ingRemainingLotsBase(ing);
      const neg = Math.max(0, toNum(ing.negativeBase, 0));
      const minBase = toNum(ing.stockMinimumBase ?? ing.alertBaseQty ?? 0, 0);

      const exp = nearestExpiringLot(ing);
      const expTxt = exp ? `• DLC la + proche : ${exp.dlc} (${exp.days != null ? "J" + (exp.days >= 0 ? "-" + exp.days : "+" + Math.abs(exp.days)) : "?"})` : "";

      const header = el("div", { class: "row", style: "display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;" }, [
        el("div", {}, [
          el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;" }, [
            el("h3", { style: "margin:0;" }, [ing.name]),
            el("span", { class: `pill pill-${status}` }, [status === "red" ? "Critique" : status === "orange" ? "A surveiller" : "OK"]),
            el("span", { class: "pill pill-muted" }, [safeText(ing.categorie || "—")])
          ]),
          el("div", { class: "small", style: "opacity:.9;margin-top:4px;" }, [
            `Restant : ${ingredientDisplayRemainingLotsOnly(ing)} • Min : ${ingredientDisplayMin(ing)} • Max : ${ingredientDisplayMax(ing)} ${expTxt}`
          ]),
          (neg > 0) ? el("div", { class: "small", style: "opacity:.95;margin-top:4px;color:#b91c1c;" }, [
            `⚠ Stock négatif en attente : ${ingredientDisplayQty(neg, ing)}`
          ]) : null,
          el("div", { class: "small", style: "opacity:.9;margin-top:4px;" }, [
            `PMP : ${roundSmart(ingPmpUnitBase(ing))} FCFA/${ing.baseUnit} • Valeur : ${money(ingTotalValue(ing))}`
          ])
        ].filter(Boolean)),
        el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;" }, [
          el("button", { class: "btn btn-light btn-mini", type: "button", onclick: () => toggleCardForm(ing.id, "recv") }, ["➕ Réception"]),
          el("button", { class: "btn btn-light btn-mini", type: "button", onclick: () => toggleCardForm(ing.id, "out") }, ["➖ Sortie"]),
          el("button", { class: "btn btn-light btn-mini", type: "button", onclick: () => toggleCardForm(ing.id, "waste") }, ["🗑 Perte"]),
          el("button", { class: "btn btn-light btn-mini", type: "button", onclick: () => toggleCardForm(ing.id, "inv") }, ["📋 Inventaire"]),
          el("button", { class: "btn btn-secondary btn-mini", type: "button", onclick: () => editIngredient(ing.id) }, ["✎ Fiche"]),
          el("button", { class: "btn btn-pink btn-mini", type: "button", onclick: () => deleteIngredient(ing.id) }, ["Suppr."])
        ])
      ]);

      const forms = el("div", { class: "stock-forms" }, [
        renderFormReception(ing),
        renderFormSortie(ing),
        renderFormPerte(ing),
        renderFormInventaire(ing),
        renderFormHistory(ing)
      ]);

      const card = el("div", { class: `card ingredient-card stock-${status}`, style: "margin:10px 0;", "data-ing": ing.id }, [header, forms]);

      wrapper.appendChild(card);
    }

    container.innerHTML = "";
    container.appendChild(wrapper);
    } catch (e) {
      console.error("BFM: renderIngredients error", e);
      container.innerHTML = "<div class=\"card\" style=\"padding:12px;\"><strong>Erreur d\u2019affichage du stock.</strong><div class=\"small\" style=\"margin-top:6px;opacity:.85;\">Ouvre la console pour voir le d\u00e9tail (ou recharge l\u2019app).</div></div>";
    }
  }

  function toggleCardForm(ingId, form) {
    const root = document.querySelector(`[data-ing="${ingId}"]`);
    if (!root) return;

    // ferme tout
    root.querySelectorAll(".stock-form").forEach(elm => elm.classList.add("hidden"));
    const target = root.querySelector(`.stock-form[data-form="${form}"]`);
    if (target) {
      target.classList.toggle("hidden");
      // Toujours afficher l'historique sous les formulaires ouverts
      const h = root.querySelector('.stock-form[data-form="hist"]');
      if (h) h.classList.remove("hidden");
    }
  }

  function renderFormReception(ing) {
    const wrap = el("div", { class: "stock-form hidden", "data-form": "recv" }, []);
    wrap.dataset.form = "recv";
    wrap.dataset.ing = ing.id; // pas utilisé ici
    wrap.innerHTML = `
      <div class="stock-form-title">Réception (nouveau lot)</div>
      <div class="form-grid" style="grid-template-columns: repeat(auto-fit,minmax(160px,1fr)); gap:10px;">
        <div><label>Quantité</label><input type="number" min="0" step="0.01" id="recv-qty-${ing.id}" placeholder="ex: 5"></div>
        <div><label>Unité</label>
          <select id="recv-unit-${ing.id}">
            <option value="g">g</option><option value="kg">kg</option>
            <option value="ml">ml</option><option value="l">L</option>
            <option value="piece">pièce</option>
          </select>
        </div>
        <div><label>Prix achat HT (total)</label><input type="number" min="0" step="1" id="recv-price-${ing.id}" placeholder="ex: 3500"></div>
        <div><label>Frais approche (total)</label><input type="number" min="0" step="1" id="recv-fees-${ing.id}" placeholder="ex: 500"></div>
        <div><label>DLC</label><input type="date" id="recv-dlc-${ing.id}"></div>
        <div><label>N° lot fournisseur</label><input id="recv-lotno-${ing.id}" placeholder="ex: LOT-123"></div>
      </div>
      <button class="btn btn-primary" type="button" id="btn-recv-${ing.id}">Valider réception</button>
    `;
    // container dataset for toggle lookup
    const outer = el("div", { "data-ing": ing.id }, [wrap]);
    // hack: outer wrapper for toggle query
    // On renverra outer et on y appendra d'autres forms plus bas, donc ici on renvoie juste wrap
    // => On ne fait pas outer ici. (la recherche [data-ing] est sur le card via renderFormHistory)
    setTimeout(() => {
      const btn = document.getElementById(`btn-recv-${ing.id}`);
      if (btn) btn.onclick = () => {
        const qty = toNum(document.getElementById(`recv-qty-${ing.id}`)?.value, 0);
        const unit = document.getElementById(`recv-unit-${ing.id}`)?.value || ingDisplayUnit(ing);
        const price = toNum(document.getElementById(`recv-price-${ing.id}`)?.value, 0);
        const fees = toNum(document.getElementById(`recv-fees-${ing.id}`)?.value, 0);
        const dlc = document.getElementById(`recv-dlc-${ing.id}`)?.value || "";
        const lotNo = safeText(document.getElementById(`recv-lotno-${ing.id}`)?.value || "");
        const { baseQty, baseUnit } = unitToBaseQty(qty, unit);
        if (baseUnit !== ing.baseUnit) return toast(`Unité incohérente : ${unit} vs ${ing.baseUnit}.`);
        addStockLot(ing.id, { qtyBase: baseQty, priceHTTotal: price, fraisApprocheTotal: fees, dlc, numeroLotFournisseur: lotNo }, "Réception");
      };
    }, 0);
    return wrap;
  }

  function renderFormSortie(ing) {
    const wrap = el("div", { class: "stock-form hidden", "data-form": "out" }, []);
    wrap.dataset.form = "out";
    wrap.innerHTML = `
      <div class="stock-form-title">Sortie manuelle</div>
      <div class="form-grid" style="grid-template-columns: repeat(auto-fit,minmax(160px,1fr)); gap:10px;">
        <div><label>Quantité</label><input type="number" min="0" step="0.01" id="out-qty-${ing.id}" placeholder="ex: 250"></div>
        <div><label>Unité</label>
          <select id="out-unit-${ing.id}">
            <option value="g">g</option><option value="kg">kg</option>
            <option value="ml">ml</option><option value="l">L</option>
            <option value="piece">pièce</option>
          </select>
        </div>
        <div style="grid-column:1/-1;"><label>Motif</label><input id="out-motif-${ing.id}" placeholder="ex: utilisation interne"></div>
      </div>
      <button class="btn btn-primary" type="button" id="btn-out-${ing.id}">Valider sortie</button>
    `;
    setTimeout(() => {
      const btn = document.getElementById(`btn-out-${ing.id}`);
      if (btn) btn.onclick = () => {
        const qty = toNum(document.getElementById(`out-qty-${ing.id}`)?.value, 0);
        const unit = document.getElementById(`out-unit-${ing.id}`)?.value || ingDisplayUnit(ing);
        const motif = safeText(document.getElementById(`out-motif-${ing.id}`)?.value || "Sortie manuelle");
        const { baseQty, baseUnit } = unitToBaseQty(qty, unit);
        if (baseUnit !== ing.baseUnit) return toast(`Unité incohérente : ${unit} vs ${ing.baseUnit}.`);
        const res = consumeFIFO(ing.id, baseQty, { type: "SORTIE", motif });
        if (!res.ok) return toast(res.msg);
        toast("Sortie enregistrée ✅");
        renderIngredients();
      };
    }, 0);
    return wrap;
  }

  function renderFormPerte(ing) {
    const wrap = el("div", { class: "stock-form hidden", "data-form": "waste" }, []);
    wrap.dataset.form = "waste";
    wrap.innerHTML = `
      <div class="stock-form-title">Perte / Gaspillage (waste)</div>
      <div class="form-grid" style="grid-template-columns: repeat(auto-fit,minmax(160px,1fr)); gap:10px;">
        <div><label>Quantité</label><input type="number" min="0" step="0.01" id="waste-qty-${ing.id}" placeholder="ex: 100"></div>
        <div><label>Unité</label>
          <select id="waste-unit-${ing.id}">
            <option value="g">g</option><option value="kg">kg</option>
            <option value="ml">ml</option><option value="l">L</option>
            <option value="piece">pièce</option>
          </select>
        </div>
        <div style="grid-column:1/-1;"><label>Motif</label><input id="waste-motif-${ing.id}" placeholder="ex: périmé / casse"></div>
      </div>
      <button class="btn btn-danger" type="button" id="btn-waste-${ing.id}">Déclarer perte</button>
    `;
    setTimeout(() => {
      const btn = document.getElementById(`btn-waste-${ing.id}`);
      if (btn) btn.onclick = () => {
        const qty = toNum(document.getElementById(`waste-qty-${ing.id}`)?.value, 0);
        const unit = document.getElementById(`waste-unit-${ing.id}`)?.value || ingDisplayUnit(ing);
        const motif = safeText(document.getElementById(`waste-motif-${ing.id}`)?.value || "Perte");
        const { baseQty, baseUnit } = unitToBaseQty(qty, unit);
        if (baseUnit !== ing.baseUnit) return toast(`Unité incohérente : ${unit} vs ${ing.baseUnit}.`);
        const res = consumeFIFO(ing.id, baseQty, { type: "PERTE", motif });
        if (!res.ok) return toast(res.msg);
        toast("Perte enregistrée ✅");
        renderIngredients();
      };
    }, 0);
    return wrap;
  }

  function renderFormInventaire(ing) {
    const wrap = el("div", { class: "stock-form hidden", "data-form": "inv" }, []);
    wrap.dataset.form = "inv";
    wrap.innerHTML = `
      <div class="stock-form-title">Inventaire (stock physique)</div>
      <div class="form-grid" style="grid-template-columns: repeat(auto-fit,minmax(160px,1fr)); gap:10px;">
        <div><label>Stock physique</label><input type="number" min="0" step="0.01" id="inv-qty-${ing.id}" placeholder="ex: 350"></div>
        <div><label>Unité</label>
          <select id="inv-unit-${ing.id}">
            <option value="g">g</option><option value="kg">kg</option>
            <option value="ml">ml</option><option value="l">L</option>
            <option value="piece">pièce</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" type="button" id="btn-inv-${ing.id}">Valider inventaire</button>
      <div class="small" style="opacity:.85;margin-top:6px;">Le système calcule l'écart avec le stock théorique (lots) et ajuste automatiquement.</div>
    `;
    setTimeout(() => {
      const btn = document.getElementById(`btn-inv-${ing.id}`);
      if (btn) btn.onclick = () => {
        const phys = toNum(document.getElementById(`inv-qty-${ing.id}`)?.value, 0);
        const unit = document.getElementById(`inv-unit-${ing.id}`)?.value || ingDisplayUnit(ing);
        const { baseQty, baseUnit } = unitToBaseQty(phys, unit);
        if (baseUnit !== ing.baseUnit) return toast(`Unité incohérente : ${unit} vs ${ing.baseUnit}.`);

        const theoretical = ingRemainingLotsBase(ing);
        const delta = baseQty - theoretical;

        if (Math.abs(delta) < 1e-9) {
          recordStockMovement({ type: "INVENTAIRE", ingredientId: ing.id, lotId: null, qtyBase: 0, costTotal: 0, motif: "Inventaire (aucun écart)" });
          saveState();
          toast("Inventaire OK ✅");
          return renderIngredients();
        }

        if (delta < 0) {
          // Stock physique < théorique => on retire en FIFO
          const res = consumeFIFO(ing.id, Math.abs(delta), { type: "INVENTAIRE", motif: "Ajustement inventaire (manquant)" });
          if (!res.ok) return toast(res.msg);
          toast("Inventaire ajusté (manquant) ✅");
        } else {
          // Stock physique > théorique => on ajoute un lot d'ajustement (au PMP)
          const unitCost = ingPmpUnitBase(ing);
          const lot = {
            idLot: uid(),
            dateEntree: dateISO(),
            dlc: "",
            quantiteInitialeBase: delta,
            quantiteRestanteBase: delta,
            numeroLotFournisseur: "INVENTAIRE",
            prixAchatHTTotal: 0,
            fraisApprocheTotal: 0,
            coutRenduUnitaireBase: unitCost
          };
          ingLots(ing).push(lot);
          recordStockMovement({ type: "INVENTAIRE", ingredientId: ing.id, lotId: lot.idLot, qtyBase: delta, costTotal: delta * unitCost, motif: "Ajustement inventaire (surplus)" });
          updateIngPmp(ing);
          saveState();
          toast("Inventaire ajusté (surplus) ✅");
        }

        purgeOldClosedLots(6);
        renderIngredients();
      };
    }, 0);
    return wrap;
  }

  function renderFormHistory(ing) {
    const wrap = el("div", { class: "stock-form", "data-form": "hist" }, []);
    wrap.dataset.form = "hist";
    wrap.dataset.ing = ing.id; // important pour toggle
    const moves = (state.stockMovements || []).filter(m => m.ingredientId === ing.id)
      .sort((a,b)=> new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, 8);

    if (!moves.length) {
      wrap.innerHTML = `<div class="stock-form-title">Historique</div><div class="small" style="opacity:.85;">Aucun mouvement.</div>`;
      return wrap;
    }

    const lines = moves.map(m => {
      const sign = (m.type === "ENTREE") ? "+" : "-";
      const lot = m.lotId ? `lot ${m.lotId}` : "lot ND";
      return `<div class="move-line"><strong>${m.type}</strong> • ${sign}${roundSmart(m.qtyBase)} ${ing.baseUnit} • ${money(m.costTotal)} • ${lot}<br><span class="small" style="opacity:.8;">${safeText(m.motif||"")}</span></div>`;
    }).join("");

    wrap.innerHTML = `<div class="stock-form-title">Historique (8 derniers)</div>${lines}`;
    return wrap;
  }

  function refreshRecipeIngredientSelect() {
    const sel = $("rec-ingredient-select");
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Choisir un ingrédient --</option>';

    const sorted = [...state.ingredients].sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
    for (const ing of sorted) {
      const opt = document.createElement("option");
      opt.value = ing.id;
      opt.textContent = ing.name;
      sel.appendChild(opt);
    }
  }

  /* =========================
     6) Recettes (production)
  ========================== */
  let recipeDraft = []; // [{ingredientId,qtyEntered,unitEntered,baseQty,cost}]

  let editingRecipeId = null; // mode édition d'une production existante

  function ensureRecipeCancelButton() {
    const saveBtn = $("btn-save-recipe");
    if (!saveBtn) return;
    // Injecter un bouton Annuler si absent (ton HTML ne l'a pas)
    if ($("btn-cancel-recipe-edit")) return;

    const cancel = document.createElement("button");
    cancel.id = "btn-cancel-recipe-edit";
    cancel.type = "button";
    cancel.className = "btn btn-secondary";
    cancel.textContent = "Annuler modification";
    cancel.style.marginLeft = "8px";
    cancel.style.display = "none";
    saveBtn.parentElement?.appendChild(cancel);

    on(cancel, "click", cancelEditRecipe);
  }

  function ensureRecipeDeductUI() {
    // injecte un contrôle "Déduire du stock xN" dans la page Recettes (sans toucher l'HTML)
    const page = $("page-recettes");
    if (!page) return;

    if (!$("rec-deduct-wrap")) {
      // On essaie de le placer juste avant le bouton d'enregistrement
      const saveBtn = $("btn-save-recipe");
      const wrap = document.createElement("div");
      wrap.id = "rec-deduct-wrap";
      wrap.className = "card";
      wrap.style.marginTop = "12px";
      wrap.style.padding = "12px";
      wrap.innerHTML = `
        <h3 style="margin-top:0;">Stock ingrédients</h3>
        <div class="form-grid" style="grid-template-columns: 1fr 160px; gap: 10px;">
          <div>
            <label style="display:flex;align-items:center;gap:10px;">
              <input type="checkbox" id="rec-deduct-stock" checked />
              <span><strong>Déduire du stock</strong> (ingrédients)</span>
            </label>
            <div class="small" style="opacity:.85;margin-top:6px;">
              Si décoché : la production est enregistrée et le stock de produits finis augmente,
              mais <strong>les ingrédients ne sont pas décrémentés</strong>.
            </div>
          </div>
          <div>
            <label>Multiplicateur</label>
            <select id="rec-deduct-mult">
              ${[...Array(10)].map((_,i)=>`<option value="${i+1}">x${i+1}</option>`).join("")}
            </select>
            <div class="small" style="opacity:.85;margin-top:6px;">
              x2 = 2 fournées (consommation et production multipliées).
            </div>
          </div>
        </div>
      `;

      // insertion
      if (saveBtn && saveBtn.parentElement) {
        saveBtn.parentElement.insertAdjacentElement("beforebegin", wrap);
      } else {
        page.appendChild(wrap);
      }

      // live recalcul dans la liste (optionnel)
      const multSel = $("rec-deduct-mult");
      const chk = $("rec-deduct-stock");
      if (multSel) multSel.addEventListener("change", renderRecipeDraftList);
      if (chk) chk.addEventListener("change", renderRecipeDraftList);
    }

    // En mode édition, on évite de changer le multiplicateur / mode de déduction (risque compta)
    const isEdit = !!editingRecipeId;
    const chk = $("rec-deduct-stock");
    const mult = $("rec-deduct-mult");
    if (chk) chk.disabled = isEdit;
    if (mult) mult.disabled = isEdit;
  }


  function setRecipeFormMode(isEdit) {
    const btn = $("btn-save-recipe");
    const cancelBtn = $("btn-cancel-recipe-edit");
    if (btn) btn.textContent = isEdit ? "Mettre à jour la production" : "Enregistrer la production";
    if (cancelBtn) cancelBtn.style.display = isEdit ? "inline-flex" : "none";
  }

  function recipeIsUsed(r) {
    // si remaining < produced => une partie a été vendue/consommée dans packs
    return toNum(r.remainingQty, 0) < toNum(r.producedQty, 0);
  }

  function startEditRecipe(id) {
    const r = state.recipes.find(x => x.id === id);
    if (!r) return;

    ensureRecipeCancelButton();
    editingRecipeId = id;

    if ($("rec-nom")) $("rec-nom").value = r.name || "";
    if ($("rec-nb-gaufres")) $("rec-nb-gaufres").value = String(r.producedQty ?? "");
    if ($("rec-prix-vente")) $("rec-prix-vente").value = String(r.salePrice ?? "");

    recipeDraft = (r.ingredients || []).map(it => ({
      ingredientId: it.ingredientId,
      name: it.name,
      qtyEntered: toNum(it.qtyEntered, 0),
      unitEntered: it.unitEntered || (state.ingredients.find(i => i.id === it.ingredientId)?.displayUnit) || "g",
      baseQty: toNum(it.baseQty, 0),
      cost: toNum(it.cost, 0)
    }));

    setRecipeFormMode(true);
    renderRecipeDraftList();

    if (recipeIsUsed(r)) {
      toast("⚠️ Cette production a déjà été utilisée (vente/pack). Tu peux modifier NOM + PRIX uniquement.");
    } else {
      toast("Mode modification recette ✅");
    }

    showPage("recettes");
  }

  function cancelEditRecipe() {
    editingRecipeId = null;
    recipeDraft = [];
    if ($("rec-nom")) $("rec-nom").value = "";
    if ($("rec-nb-gaufres")) $("rec-nb-gaufres").value = "";
    if ($("rec-prix-vente")) $("rec-prix-vente").value = "";
    if ($("rec-deduct-stock")) $("rec-deduct-stock").checked = true;
    if ($("rec-deduct-mult")) $("rec-deduct-mult").value = "1";
    setRecipeFormMode(false);
    renderRecipeDraftList();
    toast("Modification annulée.");
  }

  
function restoreStockFromBreakdown(ing, breakdown, motif = "Rollback production") {
    if (!ing) return;
    const parts = Array.isArray(breakdown) ? breakdown : [];

    for (const b of parts) {
      const qty = toNum(b.qtyBase, 0);
      if (qty <= 0) continue;

      if (!b.idLot) {
        // C'était du négatif
        ing.negativeBase = Math.max(0, toNum(ing.negativeBase, 0) - qty);
        recordStockMovement({ type: "ENTREE", ingredientId: ing.id, lotId: null, qtyBase: qty, costTotal: qty * toNum(b.coutRenduUnitaireBase, 0), motif: `${motif} (annule négatif)` });
        continue;
      }

      const lot = ingLots(ing).find(l => l.idLot === b.idLot);
      if (lot) {
        lot.quantiteRestanteBase = toNum(lot.quantiteRestanteBase, 0) + qty;
        recordStockMovement({ type: "ENTREE", ingredientId: ing.id, lotId: lot.idLot, qtyBase: qty, costTotal: qty * toNum(b.coutRenduUnitaireBase, lot.coutRenduUnitaireBase || 0), motif });
      } else {
        // Si le lot n'existe plus (purge), on recrée un lot "restauration"
        const recreated = {
          idLot: uid(),
          dateEntree: dateISO(),
          dlc: b.dlc || "",
          quantiteInitialeBase: qty,
          quantiteRestanteBase: qty,
          numeroLotFournisseur: b.numeroLotFournisseur || "RESTORE",
          prixAchatHTTotal: 0,
          fraisApprocheTotal: 0,
          coutRenduUnitaireBase: toNum(b.coutRenduUnitaireBase, 0)
        };
        ingLots(ing).push(recreated);
        recordStockMovement({ type: "ENTREE", ingredientId: ing.id, lotId: recreated.idLot, qtyBase: qty, costTotal: qty * toNum(recreated.coutRenduUnitaireBase, 0), motif: `${motif} (lot recréé)` });
      }
    }

    updateIngPmp(ing);
  }

  function rollbackRecipeProduction(r) {
    // Rendre les ingrédients consommés (uniquement si la prod a réellement décrémenté le stock)
    if (r.deductStock !== false) {
      for (const it of (r.ingredients || [])) {
        const ing = state.ingredients.find(i => i.id === it.ingredientId);
        if (!ing) continue;

        if (Array.isArray(it.lotBreakdown) && it.lotBreakdown.length) {
          restoreStockFromBreakdown(ing, it.lotBreakdown, `Annulation production: ${r.name || ""}`);
        } else {
          // Anciennes recettes: pas de détail lot => on recrée un lot d'ajustement
          const qty = toNum(it.baseQty, 0);
          if (qty > 0) {
            const unitCost = ingPmpUnitBase(ing);
            const lot = {
              idLot: uid(),
              dateEntree: dateISO(),
              dlc: "",
              quantiteInitialeBase: qty,
              quantiteRestanteBase: qty,
              numeroLotFournisseur: "ROLLBACK",
              prixAchatHTTotal: 0,
              fraisApprocheTotal: 0,
              coutRenduUnitaireBase: unitCost
            };
            ingLots(ing).push(lot);
            recordStockMovement({ type: "INVENTAIRE", ingredientId: ing.id, lotId: lot.idLot, qtyBase: qty, costTotal: qty * unitCost, motif: `Annulation production (ancien format): ${r.name || ""}` });
          }
        }
      }
      purgeOldClosedLots(6);
      saveState();
    }

    // Retirer les produits finis associés (unités + valeur au coût de cette production)
    state.inventory.finishedUnits = Math.max(0, toNum(state.inventory.finishedUnits, 0) - toNum(r.producedQty, 0));
    state.inventory.finishedValue = Math.max(0, toNum(state.inventory.finishedValue, 0) - toNum(r.costTotal, 0));
  }




  function addIngredientToRecipeDraft() {
    const ingId = $("rec-ingredient-select")?.value;
    const qty = toNum($("rec-ingredient-qte")?.value, 0);
    const unit = $("rec-ingredient-unit")?.value || "g";

    if (!ingId) return toast("Choisis un ingrédient.");
    if (qty <= 0) return toast("Quantité invalide.");

    const ing = state.ingredients.find(i => i.id === ingId);
    if (!ing) return toast("Ingrédient introuvable.");

    const { baseQty, baseUnit } = unitToBaseQty(qty, unit);

    // compatibilité baseUnit
    if (ing.baseUnit !== baseUnit) {
      // Ex: tu choisis kg pour un ingrédient en ml (incohérent)
      return toast(`Unité incohérente : ${ing.name} est en ${ing.baseUnit}.`);
    }

    const cost = pricePerBaseUnit(ing) * baseQty;

    // ajoute / cumule si déjà présent
    const existing = recipeDraft.find(x => x.ingredientId === ingId && x.unitEntered === unit);
    if (existing) {
      existing.qtyEntered += qty;
      existing.baseQty += baseQty;
      existing.cost += cost;
    } else {
      recipeDraft.push({
        ingredientId: ingId,
        name: ing.name,
        qtyEntered: qty,
        unitEntered: unit,
        baseQty,
        cost
      });
    }

    if ($("rec-ingredient-qte")) $("rec-ingredient-qte").value = "";
    renderRecipeDraftList();
  }

  function removeDraftIngredient(index) {
    recipeDraft.splice(index, 1);
    renderRecipeDraftList();
  }

  function renderRecipeDraftList() {
    const box = $("rec-ingredients-list");
    if (!box) return;

    if (!recipeDraft.length) {
      box.innerHTML = "<em>Aucun ingrédient ajouté pour le moment.</em>";
      return;
    }

    const ul = el("div", { class: "bfm-list" });
    recipeDraft.forEach((it, idx) => {
      ul.appendChild(
        el("div", { class: "card", style: "margin:8px 0;padding:10px;" }, [
          el("div", { style: "display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;" }, [
            el("div", {}, [
              el("strong", {}, [it.name]),
              el("div", { class: "small", style: "opacity:.9;" }, [`Quantité : ${roundSmart(it.qtyEntered)} ${it.unitEntered}`]),
              el("div", { class: "small", style: "opacity:.9;" }, [`Coût utilisé : ${money(it.cost)}`])
            ]),
            el("button", { class: "btn btn-pink", type: "button", onclick: () => removeDraftIngredient(idx) }, ["Retirer"])
          ])
        ])
      );
    });

    const totalCost = recipeDraft.reduce((s, x) => s + toNum(x.cost, 0), 0);
    ul.appendChild(el("div", { class: "small", style: "opacity:.9;margin-top:8px;" }, [`Total ingrédients : ${money(totalCost)}`]));

    box.innerHTML = "";
    box.appendChild(ul);
  }

  function computeRecipeCapacity(recipe) {
    // nombre de produits finis possibles avec les stocks restants, si on refait EXACTEMENT cette recette
    // => min over ingredients: floor(remaining / requiredPerBatch) * producedQty
    const produced = toNum(recipe.producedQty, 0);
    if (produced <= 0) return 0;

    let batchesPossible = Infinity;
    for (const it of (recipe.ingredients || [])) {
      const ing = state.ingredients.find(x => x.id === it.ingredientId);
      if (!ing) { batchesPossible = 0; break; }
      const req = toNum(it.baseQty, 0);
      if (req <= 0) continue;
      batchesPossible = Math.min(batchesPossible, Math.floor(ingRemainingLotsBase(ing) / req));
    }
    if (!Number.isFinite(batchesPossible)) batchesPossible = 0;
    return Math.max(0, batchesPossible * produced);
  }

  
  
function saveRecipeProduction() {
    ensureRecipeCancelButton();

    const name = safeText($("rec-nom")?.value);
    const producedQtyBatch = Math.floor(toNum($("rec-nb-gaufres")?.value, 0));
    const salePrice = Math.round(toNum($("rec-prix-vente")?.value, 0));

    // Option: déduire le stock ingrédients + multiplicateur xN
    const deductStock = $("rec-deduct-stock") ? !!$("rec-deduct-stock").checked : true;
    const mult = Math.max(1, Math.min(10, Math.floor(toNum($("rec-deduct-mult")?.value, 1))));

    if (!name) return toast("Nom de recette manquant.");
    if (producedQtyBatch <= 0) return toast("Nombre de produits finis invalide.");
    if (!recipeDraft.length) return toast("Ajoute au moins un ingrédient.");

    const producedTotal = producedQtyBatch * mult;

    // Si on édite une production existante : rollback d'abord (ça remet le stock + retire les produits finis)
    let recipe = null;
    if (editingRecipeId) {
      recipe = state.recipes.find(x => x.id === editingRecipeId);
      if (!recipe) {
        toast("Production introuvable (édition annulée).");
        editingRecipeId = null;
      } else {
        rollbackRecipeProduction(recipe);
      }
    }

    // Pré-check stock (si déduction active ET stock négatif interdit)
    if (deductStock && !state.config.allowNegativeStock) {
      for (const it of recipeDraft) {
        const ing = state.ingredients.find(i => i.id === it.ingredientId);
        if (!ing) return toast(`Ingrédient manquant : ${it.name}`);
        const needBase = toNum(it.baseQty, 0) * mult;
        if (ingRemainingLotsBase(ing) < needBase - 1e-9) {
          return toast(`Stock insuffisant pour : ${ing.name} (restant ${ingredientDisplayRemainingLotsOnly(ing)})`);
        }
      }
    }

    // Calcul coût + (optionnel) déduction FIFO
    let costTotal = 0;
    const ingredientsFinal = [];

    for (const it of recipeDraft) {
      const ing = state.ingredients.find(i => i.id === it.ingredientId);
      if (!ing) return toast(`Ingrédient manquant : ${it.name}`);

      const needBase = toNum(it.baseQty, 0) * mult;

      let cost = 0;
      let lotBreakdown = [];

      if (deductStock) {
        const res = consumeFIFO(ing.id, needBase, { type: "SORTIE", motif: `Production: ${name}`, meta: { recipeId: editingRecipeId || "new" } });
        if (!res.ok) return toast(res.msg);
        cost = toNum(res.costTotal, 0);
        lotBreakdown = res.breakdown || [];
      } else {
        cost = ingPmpUnitBase(ing) * needBase;
      }

      costTotal += cost;

      ingredientsFinal.push({
        ingredientId: ing.id,
        name: ing.name,
        qtyEntered: it.qtyEntered,
        unitEntered: it.unitEntered,
        baseQty: needBase,
        cost,
        lotBreakdown
      });
    }

    const costPerUnit = producedTotal > 0 ? (costTotal / producedTotal) : 0;

    // Enregistrer / mettre à jour
    if (recipe) {
      recipe.name = name;
      recipe.producedQty = producedTotal;
      recipe.salePrice = salePrice;
      recipe.ingredients = ingredientsFinal;
      recipe.costTotal = costTotal;
      recipe.costPerUnit = costPerUnit;
      recipe.deductStock = deductStock;
      recipe.mult = mult;
      recipe.updatedAt = new Date().toISOString();
    } else {
      recipe = {
        id: uid(),
        name,
        producedQty: producedTotal,
        salePrice,
        ingredients: ingredientsFinal,
        costTotal,
        costPerUnit,
        deductStock,
        mult,
        createdAt: new Date().toISOString()
      };
      state.recipes.push(recipe);
    }

    // Ajouter à l'inventaire (valeur au coût)
    state.inventory.finishedUnits += producedTotal;
    state.inventory.finishedValue += costTotal;

    // reset UI
    if ($("rec-nom")) $("rec-nom").value = "";
    if ($("rec-nb-gaufres")) $("rec-nb-gaufres").value = "";
    if ($("rec-prix-vente")) $("rec-prix-vente").value = "";
    recipeDraft = [];
    renderRecipeDraftList();

    saveState();
    renderIngredients();
    renderRecipes();
    refreshPackRecipeOptions();
    refreshSalePackSelect();
    renderDashboard();
    renderStockSummary();

    if (editingRecipeId) {
      toast("Recette (production) modifiée ✅");
      cancelEditRecipe();
    } else {
      toast("Recette (production) enregistrée ✅");
    }
  }

function renderRecipes() {
    const box = $("rec-liste");
    if (!box) return;

    if (!state.recipes.length) {
      box.innerHTML = "<em>Aucune recette enregistrée.</em>";
      return;
    }

    const list = [...state.recipes].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const wrapper = el("div");

    for (const r of list) {
      const marginUnit = toNum(r.salePrice, 0) - toNum(r.costPerUnit, 0);
      const marginPct = (toNum(r.salePrice, 0) > 0) ? (marginUnit / toNum(r.salePrice, 0)) * 100 : 0;
      const cap = computeRecipeCapacity(r);

      const card = el("div", { class: "card", style: "margin:10px 0;" }, [
        el("div", { style: "display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;" }, [
          el("div", {}, [
            el("h3", {}, [r.name]),
            el("div", { class: "small", style: "opacity:.9;" }, [
              `Production : ${r.producedQty} (restant: ${Math.floor(toNum(r.remainingQty, r.producedQty))}) • Coût total : ${money(r.costTotal)} • Coût/unité : ${roundSmart(r.costPerUnit)} FCFA`
            ]),
            el("div", { class: "small", style: "opacity:.9;" }, [
              `Prix vente/unité : ${money(r.salePrice)} • Marge/unité : ${roundSmart(marginUnit)} FCFA (${roundSmart(marginPct)}%)`
            ]),
            el("div", { class: "small", style: "opacity:.9;" }, [
              `Capacité théorique restante (si on refait cette recette) : ${cap} ${state.config.produitP || "produits"}`
            ])
          ]),
          el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;" }, [
            el("button", { class: "btn btn-secondary", type: "button", onclick: () => startEditRecipe(r.id) }, ["Modifier"]),
            el("button", { class: "btn btn-pink", type: "button", onclick: () => deleteRecipe(r.id) }, ["Supprimer"])
          ])
        ]),
        el("details", { style: "margin-top:10px;" }, [
          el("summary", {}, ["Voir ingrédients utilisés"]),
          el("div", { style: "margin-top:8px;" }, [
            ...r.ingredients.map(it => el("div", { class: "small", style: "opacity:.9;margin:3px 0;" }, [
              `• ${it.name} : ${roundSmart(it.qtyEntered)} ${it.unitEntered} — ${money(it.cost)}`
            ]))
          ])
        ])
      ]);

      wrapper.appendChild(card);
    }

    box.innerHTML = "";
    box.appendChild(wrapper);
  }

  function deleteRecipe(id) {
    // Attention: recette = une production, donc la supprimer devrait "remettre" stock et inventaire.
    const r = state.recipes.find(x => x.id === id);
    if (!r) return;

    if (recipeIsUsed(r)) {
      return toast("Impossible : cette production a déjà été utilisée (vente/pack).");
    }

    if (!confirm("Supprimer cette recette (production) va retirer ces produits du stock et annuler la consommation d\'ingrédients. Continuer ?")) return;

    // rendre stock ingrédients (si la prod a décrémenté le stock)
    if (r.deductStock !== false) {
      for (const it of (r.ingredients || [])) {
        const ing = state.ingredients.find(i => i.id === it.ingredientId);
        if (!ing) continue;

        if (Array.isArray(it.lotBreakdown) && it.lotBreakdown.length) {
          restoreStockFromBreakdown(ing, it.lotBreakdown, `Suppression production: ${r.name || ""}`);
        } else {
          const qty = toNum(it.baseQty, 0);
          if (qty > 0) {
            const unitCost = ingPmpUnitBase(ing);
            const lot = {
              idLot: uid(),
              dateEntree: dateISO(),
              dlc: "",
              quantiteInitialeBase: qty,
              quantiteRestanteBase: qty,
              numeroLotFournisseur: "DELETE_RECIPE",
              prixAchatHTTotal: 0,
              fraisApprocheTotal: 0,
              coutRenduUnitaireBase: unitCost
            };
            ingLots(ing).push(lot);
            recordStockMovement({ type: "INVENTAIRE", ingredientId: ing.id, lotId: lot.idLot, qtyBase: qty, costTotal: qty * unitCost, motif: `Suppression production (ancien format): ${r.name || ""}` });
          }
        }
      }
    }
// retirer de l'inventaire
    state.inventory.finishedUnits = Math.max(0, toNum(state.inventory.finishedUnits, 0) - toNum(r.producedQty, 0));
    state.inventory.finishedValue = Math.max(0, toNum(state.inventory.finishedValue, 0) - toNum(r.costTotal, 0));

    // retirer la recette
    state.recipes = state.recipes.filter(x => x.id !== id);

    saveState();
    renderIngredients();
    renderRecipes();
    refreshPackRecipeOptions();
    refreshSalePackSelect();
    renderDashboard();
    toast("Recette supprimée.");
  }

  /* =========================
     7) Packs
  ========================== */
  let packDraftRows = []; // [{id, recipeId, qty}]
  let editingPackId = null; // pack en cours d'édition (sinon null)

  function refreshPackRecipeOptions() {
    // rien à faire ici directement: options sont rendues dans les rows
    // on s'assure juste qu'on a au moins une row si vide
    if (!packDraftRows.length) {
      packDraftRows = [{ id: uid(), recipeId: "", qty: 1 }];
    }
  }

  function addPackRow() {
    packDraftRows.push({ id: uid(), recipeId: "", qty: 1 });
    renderPackDraft();
  }

  function removePackRow(rowId) {
    packDraftRows = packDraftRows.filter(r => r.id !== rowId);
    if (!packDraftRows.length) packDraftRows = [{ id: uid(), recipeId: "", qty: 1 }];
    renderPackDraft();
  
  function updatePackEditUI() {
    const box = $("pack-edit-box");
    const nameEl = $("pack-edit-name");
    const btnCancel = $("btn-pack-cancel-edit");

    if (btnCancel && !btnCancel._bfmBound) {
      btnCancel._bfmBound = true;
      btnCancel.addEventListener("click", cancelPackEdit);
    }

    if (!box) return;

    if (editingPackId) {
      const p = state.packs.find(x => x.id === editingPackId);
      box.classList.remove("hidden");
      if (nameEl) nameEl.textContent = p ? `Pack : ${p.name}` : "";
    } else {
      box.classList.add("hidden");
      if (nameEl) nameEl.textContent = "";
    }
  }

  function editPack(packId) {
    const p = state.packs.find(x => x.id === packId);
    if (!p) return toast("Pack introuvable.");

    editingPackId = packId;

    if ($("pack-nom")) $("pack-nom").value = p.name || "";
    if ($("pack-margin")) $("pack-margin").value = String(clamp(toNum(p.margin, 30), 0, 90));
    if ($("pack-price")) $("pack-price").value = String(Math.round(toNum(p.price, 0)));

    packDraftRows = (p.items || []).map(it => ({
      id: uid(),
      recipeId: it.recipeId,
      qty: Math.max(1, Math.floor(toNum(it.qty, 1)))
    }));
    if (!packDraftRows.length) packDraftRows = [{ id: uid(), recipeId: "", qty: 1 }];

    renderPackDraft();
    updatePackEditUI();
    toast("Mode édition activé ✎");
  }

  function cancelPackEdit() {
    editingPackId = null;
    if ($("pack-nom")) $("pack-nom").value = "";
    if ($("pack-price")) $("pack-price").value = "";
    if ($("pack-margin")) $("pack-margin").value = "30";
    packDraftRows = [{ id: uid(), recipeId: "", qty: 1 }];
    renderPackDraft();
    updatePackEditUI();
    toast("Édition annulée.");
  }

}

  function getRecipeById(id) { return state.recipes.find(r => r.id === id); }

  function recipeRemainingUnits(r) {
    return Math.max(0, Math.floor(toNum(r?.remainingQty, toNum(r?.producedQty, 0))));
  }

  function packMaxSellable(pack) {
    // Max packs vendables selon stocks des recettes composant le pack
    if (!pack || !Array.isArray(pack.items) || !pack.items.length) return 0;
    let max = Infinity;
    for (const it of pack.items) {
      const r = getRecipeById(it.recipeId);
      if (!r) return 0;
      const need = Math.max(0, Math.floor(toNum(it.qty, 0)));
      if (need <= 0) continue;
      max = Math.min(max, Math.floor(recipeRemainingUnits(r) / need));
    }
    if (!Number.isFinite(max)) max = 0;
    return Math.max(0, max);
  }


  function packCostCompute() {
    let total = 0;
    for (const row of packDraftRows) {
      const r = getRecipeById(row.recipeId);
      if (!r) continue;
      total += toNum(r.costPerUnit, 0) * Math.max(0, Math.floor(toNum(row.qty, 0)));
    }
    return total;
  }

  function packUnitsCompute(items) {
    // items: [{recipeId,qty}]
    let units = 0;
    for (const it of items) {
      units += Math.max(0, Math.floor(toNum(it.qty, 0)));
    }
    return units;
  }

  function renderPackDraft() {
    const tbody = $("pack-items-body");
    if (!tbody) return;

    // options recettes
    const recipes = [...state.recipes].sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
    const recipeOptionsHTML = ['<option value="">-- Choisir --</option>']
      .concat(recipes.map(r => {
        const dispo = Math.floor(toNum(r.remainingQty, toNum(r.producedQty, 0)));
        const warn = dispo <= 0 ? ' — épuisé' : ` — dispo: ${dispo}`;
        return `<option value="${r.id}">${escapeHTML(r.name)}${warn}</option>`;
      }))
      .join("");

    tbody.innerHTML = "";

    for (const row of packDraftRows) {
      const tr = document.createElement("tr");

      const tdRec = document.createElement("td");
      const sel = el("select", { class: "form-control" });
      sel.innerHTML = recipeOptionsHTML;
      sel.value = row.recipeId || "";
      on(sel, "change", () => {
        row.recipeId = sel.value;
        renderPackDraft();
      });
      tdRec.appendChild(sel);

      const tdQty = document.createElement("td");
      const inputQty = el("input", { type: "number", min: "1", value: String(row.qty ?? 1), class: "form-control", style: "max-width:110px;" });
      on(inputQty, "input", () => {
        // IMPORTANT mobile: ne re-render pas à chaque chiffre (sinon le clavier se ferme)
        row.qty = Math.max(1, Math.floor(toNum(inputQty.value, row.qty ?? 1)));
      });
      on(inputQty, "change", () => {
        row.qty = Math.max(1, Math.floor(toNum(inputQty.value, row.qty ?? 1)));
        renderPackDraft();
      });
      on(inputQty, "keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); inputQty.blur(); }
      });
      tdQty.appendChild(inputQty);

      const tdCost = document.createElement("td");
      const r = getRecipeById(row.recipeId);
      const lineCost = r ? (toNum(r.costPerUnit, 0) * Math.max(1, Math.floor(toNum(row.qty, 1)))) : 0;
      tdCost.textContent = money(lineCost);

      const tdDel = document.createElement("td");
      const btn = el("button", { type: "button", class: "btn btn-pink" }, ["✖"]);
      on(btn, "click", () => removePackRow(row.id));
      tdDel.appendChild(btn);

      tr.appendChild(tdRec);
      tr.appendChild(tdQty);
      tr.appendChild(tdCost);
      tr.appendChild(tdDel);

      tbody.appendChild(tr);
    }

    const total = packCostCompute();
    if ($("pack-cost")) $("pack-cost").textContent = money(total);

    // Alerte disponibilité (création pack)
    let warnBox = $("pack-warning");
    if (!warnBox) {
      const costEl = $("pack-cost");
      if (costEl && costEl.parentElement) {
        warnBox = document.createElement('div');
        warnBox.id = 'pack-warning';
        warnBox.className = 'small';
        warnBox.style.marginTop = '8px';
        warnBox.style.padding = '8px 10px';
        warnBox.style.borderRadius = '12px';
        warnBox.style.background = 'rgba(255, 165, 0, 0.12)';
        warnBox.style.border = '1px solid rgba(255, 165, 0, 0.25)';
        warnBox.style.display = 'none';
        costEl.parentElement.appendChild(warnBox);
      }
    }
    const exhausted = packDraftRows
      .map(r => getRecipeById(r.recipeId))
      .filter(r => r && recipeRemainingUnits(r) <= 0);
    if (warnBox) {
      warnBox.textContent = exhausted.length
        ? `⚠ Recette(s) épuisée(s) dans ce pack : ${exhausted.map(x => x.name).join(", ")}. Le pack ne sera pas vendable tant que tu n'as pas relancé une production.`
        : "";
      warnBox.style.display = exhausted.length ? "block" : "none";
    } else if (exhausted.length) {
      // fallback: pas de zone dédiée => rien
    }

    // auto-calc du prix si vide
    const margin = clamp(toNum($("pack-margin")?.value, 30), 0, 90);
    const priceInput = $("pack-price");
    if (priceInput && safeText(priceInput.value) === "") {
      const suggested = Math.ceil(total * (1 + margin / 100));
      priceInput.placeholder = `Suggestion : ${suggested}`;
    }
  }

  function escapeHTML(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function addPack() {
    const name = safeText($("pack-nom")?.value);
    const margin = clamp(toNum($("pack-margin")?.value, 30), 0, 90);
    const manualPrice = safeText($("pack-price")?.value);

    if (!name) return toast("Nom du pack manquant.");

    const items = packDraftRows
      .filter(r => r.recipeId && toNum(r.qty, 0) > 0)
      .map(r => ({ recipeId: r.recipeId, qty: Math.max(1, Math.floor(toNum(r.qty, 1))) }));

    if (!items.length) return toast("Ajoute au moins 1 recette au pack.");

    // coût + détails
    let cost = 0;
    const expanded = [];
    for (const it of items) {
      const r = getRecipeById(it.recipeId);
      if (!r) continue;
      const lineCost = toNum(r.costPerUnit, 0) * it.qty;
      cost += lineCost;
      expanded.push({
        recipeId: r.id,
        recipeName: r.name,
        qty: it.qty,
        costPerUnit: r.costPerUnit,
        lineCost
      });
    }

    const price = manualPrice === ""
      ? Math.ceil(cost * (1 + margin / 100))
      : Math.round(toNum(manualPrice, 0));

    if (price < cost - 1e-9) return toast("Pack vendu à perte : prix < coût. Corrige le prix.");

    if (editingPackId) {
      const existing = state.packs.find(x => x.id === editingPackId);
      if (!existing) {
        editingPackId = null;
      } else {
        existing.name = name;
        existing.items = expanded;
        existing.cost = cost;
        existing.margin = margin;
        existing.price = price;
        existing.updatedAt = new Date().toISOString();
      }
      toast("Pack mis à jour ✅");
    } else {
      const pack = {
        id: uid(),
        name,
        items: expanded,
        cost,
        margin,
        price,
        createdAt: new Date().toISOString()
      };
      state.packs.push(pack);
      toast("Pack créé ✅");
    }

    // reset draft + formulaire
    if ($("pack-nom")) $("pack-nom").value = "";
    if ($("pack-price")) $("pack-price").value = "";
    editingPackId = null;
    updatePackEditUI();

    packDraftRows = [{ id: uid(), recipeId: "", qty: 1 }];

    saveState();
    renderPackDraft();
    renderPacks();
    refreshSalePackSelect();
  }

  function deletePack(id) {
    const used = state.sales.some(s => (s.packs || []).some(p => p.packId === id));
    if (used) {
      if (!confirm("Ce pack existe dans l'historique des ventes. Le supprimer va enlever son nom des anciennes ventes. Continuer ?")) return;
    }
    state.packs = state.packs.filter(p => p.id !== id);
    saveState();
    renderPacks();
    refreshSalePackSelect();
    toast("Pack supprimé.");
  }

  function renderPacks() {
    const box = $("packs-list");
    if (!box) return;

    if (!state.packs.length) {
      box.innerHTML = "<em>Aucun pack créé.</em>";
      return;
    }

    const list = [...state.packs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const wrap = el("div");

    for (const p of list) {
      const marginAbs = toNum(p.price, 0) - toNum(p.cost, 0);
      const marginPct = toNum(p.price, 0) > 0 ? (marginAbs / toNum(p.price, 0)) * 100 : 0;

      wrap.appendChild(
        el("div", { class: "card", style: "margin:10px 0;" }, [
          el("div", { style: "display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;" }, [
            el("div", {}, [
              el("h3", {}, [p.name]),
              el("div", { class: "small", style: "opacity:.9;" }, [
                `Coût : ${money(p.cost)} • Prix : ${money(p.price)} • Marge : ${money(marginAbs)} (${roundSmart(marginPct)}%)`
              ])
            ]),
            el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;" }, [
              el("button", { class: "btn btn-secondary", type: "button", onclick: () => editPack(p.id) }, ["✎ Modifier"]),
              el("button", { class: "btn btn-pink", type: "button", onclick: () => deletePack(p.id) }, ["Supprimer"])
            ])
          ]),
          el("details", { style: "margin-top:10px;" }, [
            el("summary", {}, ["Voir contenu du pack"]),
            el("div", { style: "margin-top:8px;" }, [
              ...p.items.map(it => el("div", { class: "small", style: "opacity:.9;margin:3px 0;" }, [
                `• ${it.qty} × ${it.recipeName} — coût ${money(it.lineCost)}`
              ]))
            ])
          ])
        ])
      );
    }

    box.innerHTML = "";
    box.appendChild(wrap);
  }

  /* =========================
     8) Vendeurs
  ========================== */
  function addVendeur() {
    const name = safeText($("vendeur-nom")?.value);
    const comm = safeText($("vendeur-commission")?.value);
    if (!name) return toast("Nom vendeur manquant.");

    state.vendors.push({ id: uid(), name, commissionRaw: comm });
    if ($("vendeur-nom")) $("vendeur-nom").value = "";
    if ($("vendeur-commission")) $("vendeur-commission").value = "";

    saveState();
    renderVendors();
    refreshVendorsSelect();
    toast("Vendeur ajouté ✅");
  }
  window.addVendeur = addVendeur;

  function deleteVendeur(id) {
    const used = state.sales.some(s => s.vendorId === id);
    if (used) {
      if (!confirm("Ce vendeur existe dans l'historique. Le supprimer va anonymiser les anciennes ventes. Continuer ?")) return;
    }
    state.vendors = state.vendors.filter(v => v.id !== id);
    saveState();
    renderVendors();
    refreshVendorsSelect();
    renderDashboard();
  }

  function renderVendors() {
    const box = $("vendeurs-list");
    if (!box) return;

    if (!state.vendors.length) {
      box.innerHTML = "<em>Aucun vendeur enregistré.</em>";
      return;
    }

    const wrap = el("div");
    const list = [...state.vendors].sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
    for (const v of list) {
      wrap.appendChild(
        el("div", { class: "card", style: "margin:8px 0;padding:10px;" }, [
          el("div", { style: "display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;" }, [
            el("div", {}, [
              el("strong", {}, [v.name]),
              el("div", { class: "small", style: "opacity:.9;" }, [`Commission : ${v.commissionRaw || "-"}`])
            ]),
            el("button", { class: "btn btn-pink", type: "button", onclick: () => deleteVendeur(v.id) }, ["Supprimer"])
          ])
        ])
      );
    }
    box.innerHTML = "";
    box.appendChild(wrap);
  }

  function refreshVendorsSelect() {
    const sel = $("vente-vendeur");
    if (!sel) return;
    sel.innerHTML = "";

    // option vide
    sel.appendChild(el("option", { value: "" }, ["-- Choisir un vendeur --"]));

    const list = [...state.vendors].sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
    for (const v of list) {
      sel.appendChild(el("option", { value: v.id }, [v.name]));
    }
  }

  /* =========================
     9) Ventes
  ========================== */
  let saleDraftPacks = []; // [{packId, qty}]

  
  function refreshSalePackSelect() {
    const sel = $("vente-pack-select");
    if (!sel) return;

    sel.innerHTML = '<option value="">-- Choisir un pack --</option>';
    const list = [...state.packs].sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
    for (const p of list) {
      const max = packMaxSellable(p);
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.disabled = max <= 0;
      opt.textContent = `${p.name} (${money(p.price)}) — dispo: ${max}`;
      sel.appendChild(opt);
    }
  }

  function renderSaleDraftPacks() {
    const box = $("vente-packs-choisis");
    if (!box) return;

    if (!saleDraftPacks.length) {
      box.innerHTML = "<em>Aucun pack encore ajouté pour cette vente.</em>";
      return;
    }

    const wrap = el("div");
    saleDraftPacks.forEach((it, idx) => {
      const p = state.packs.find(x => x.id === it.packId);
      if (!p) return;
      const line = el("div", { class: "card", style: "margin:6px 0;padding:10px;" }, [
        el("div", { style: "display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;" }, [
          el("div", {}, [
            el("strong", {}, [p.name]),
            el("div", { class: "small", style: "opacity:.9;" }, [`Quantité : ${it.qty} • Total : ${money(p.price * it.qty)}`])
          ]),
          el("button", { class: "btn btn-pink", type: "button", onclick: () => { saleDraftPacks.splice(idx, 1); renderSaleDraftPacks(); } }, ["Retirer"])
        ])
      ]);
      wrap.appendChild(line);
    });

    box.innerHTML = "";
    box.appendChild(wrap);
  }

  function addPackToSaleDraft() {
    const packId = $("vente-pack-select")?.value;
    const qty = Math.max(1, Math.floor(toNum($("vente-pack-qte")?.value, 1)));
    if (!packId) return toast("Choisis un pack.");
    const p = state.packs.find(x => x.id === packId);
    if (!p) return toast("Pack introuvable.");

    const existing = saleDraftPacks.find(x => x.packId === packId);
    if (existing) existing.qty += qty;
    else saleDraftPacks.push({ packId, qty });

    renderSaleDraftPacks();
  }

  function inventoryAvgCost() {
    const units = toNum(state.inventory.finishedUnits, 0);
    if (units <= 0) return 0;
    return toNum(state.inventory.finishedValue, 0) / units;
  }

  function removeFromInventory(unitsToRemove) {
    const units = toNum(state.inventory.finishedUnits, 0);
    const value = toNum(state.inventory.finishedValue, 0);
    const u = Math.max(0, Math.floor(toNum(unitsToRemove, 0)));
    if (u <= 0) return 0;

    const avg = (units > 0) ? (value / units) : 0;
    const cogs = avg * u;

    state.inventory.finishedUnits = Math.max(0, units - u);
    state.inventory.finishedValue = Math.max(0, value - cogs);

    return cogs;
  }

  
  function computeRecipeNeedsFromSaleDraft() {
    // map recipeId -> units needed (from packs)
    const needs = new Map();
    for (const it of saleDraftPacks) {
      const pack = state.packs.find(x => x.id === it.packId);
      if (!pack) continue;
      const packQty = Math.max(1, Math.floor(toNum(it.qty, 1)));
      for (const item of (pack.items || [])) {
        const rid = item.recipeId;
        const needPerPack = Math.max(0, Math.floor(toNum(item.qty, 0)));
        const add = needPerPack * packQty;
        needs.set(rid, (needs.get(rid) || 0) + add);
      }
    }
    return needs;
  }

  function allocateSoloUnitsToRecipes(units) {
    // FIFO: on décrémente d'abord les productions les plus anciennes
    let remaining = Math.max(0, Math.floor(toNum(units, 0)));
    const alloc = new Map(); // recipeId -> units allocated
    const recipes = [...state.recipes]
      .filter(r => recipeRemainingUnits(r) > 0)
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));

    for (const r of recipes) {
      if (remaining <= 0) break;
      const avail = recipeRemainingUnits(r);
      const take = Math.min(avail, remaining);
      if (take > 0) {
        alloc.set(r.id, (alloc.get(r.id) || 0) + take);
        remaining -= take;
      }
    }
    return { alloc, remaining };
  }

  function applyRecipeDecrement(mapRecipeIdToUnits) {
    // map -> décrémente remainingQty
    for (const [rid, u] of mapRecipeIdToUnits.entries()) {
      const r = state.recipes.find(x => x.id === rid);
      if (!r) continue;
      r.remainingQty = Math.max(0, recipeRemainingUnits(r) - Math.max(0, Math.floor(toNum(u, 0))));
    }
  }

function saleUnitsFromPacks() {
    // Hypothèse: 1 "quantité" d'item du pack = 1 produit fini.
    // Si un pack contient 2 recettes chacune qty=2 => 4 produits finis dans le pack.
    let total = 0;
    for (const it of saleDraftPacks) {
      const p = state.packs.find(x => x.id === it.packId);
      if (!p) continue;
      const unitsPerPack = p.items.reduce((s, x) => s + Math.max(0, Math.floor(toNum(x.qty, 0))), 0);
      total += unitsPerPack * Math.max(1, Math.floor(toNum(it.qty, 1)));
    }
    return total;
  }

  function saveSale() {
    const date = $("vente-date")?.value || dateISO();
    const time = $("vente-heure")?.value || timeISO();
    const vendorId = $("vente-vendeur")?.value || "";
    const vendor = state.vendors.find(v => v.id === vendorId);
    const lieu = safeText($("vente-lieu")?.value);

    const unitsSolo = Math.max(0, Math.floor(toNum($("vente-unites")?.value, 0)));
    const unitPrice = Math.round(toNum($("vente-prix-unite")?.value, 0));

    // revenus packs
    const packsExpanded = [];
    let revenuePacks = 0;
    for (const it of saleDraftPacks) {
      const p = state.packs.find(x => x.id === it.packId);
      if (!p) continue;

      const qtyPack = Math.max(1, Math.floor(toNum(it.qty, 1)));
      const unitsPerPack = p.items.reduce((s, x) => s + Math.max(0, Math.floor(toNum(x.qty, 0))), 0);

      revenuePacks += toNum(p.price, 0) * qtyPack;

      packsExpanded.push({
        packId: p.id,
        name: p.name,
        qty: qtyPack,
        pricePerPack: p.price,
        unitsPerPack,
        total: toNum(p.price, 0) * qtyPack
      });
    }

    const revenueSolo = unitsSolo * unitPrice;
    const revenue = revenuePacks + revenueSolo;

    const unitsFromPacks = saleUnitsFromPacks();
    const totalUnits = unitsSolo + unitsFromPacks;

    // --- Contrôle stock détaillé par production (recettes) ---
    const needsFromPacks = computeRecipeNeedsFromSaleDraft(); // recipeId -> units
    // Ajouter la vente à l'unité (hors pack) en la répartissant sur les productions disponibles
    const soloAlloc = allocateSoloUnitsToRecipes(unitsSolo);
    if (soloAlloc.remaining > 0) {
      return toast(`Stock insuffisant : il manque ${soloAlloc.remaining} unité(s) pour la vente à l'unité.`);
    }
    // Fusion besoins packs + allocation solo
    const needsTotal = new Map(needsFromPacks);
    for (const [rid, u] of soloAlloc.alloc.entries()) {
      needsTotal.set(rid, (needsTotal.get(rid) || 0) + u);
    }
    // Vérifier disponibilité
    for (const [rid, need] of needsTotal.entries()) {
      const r = state.recipes.find(x => x.id === rid);
      if (!r) return toast("Recette introuvable dans un pack.");
      if (recipeRemainingUnits(r) < need) {
        const deficit = need - recipeRemainingUnits(r);
        return toast(`Pack indisponible : stock épuisé sur "${r.name}" (manque ${deficit}).`);
      }
    }

    if (totalUnits <= 0 && revenue <= 0) return toast("Rien à enregistrer (0 unité / 0 pack).");

    if (toNum(state.inventory.finishedUnits, 0) < totalUnits) {
      return toast(`Stock insuffisant : ${state.inventory.finishedUnits} restants pour ${totalUnits} vendus.`);
    }

        // Décrémenter les stocks par production (recettes)
    applyRecipeDecrement(needsTotal);

    const cogs = removeFromInventory(totalUnits);

    const sale = {
      id: uid(),
      ts: new Date(`${date}T${time}:00`).toISOString(),
      date,
      time,
      vendorId,
      vendorName: vendor ? vendor.name : "-",
      lieu,
      unitsSolo,
      unitPrice,
      packs: packsExpanded,
      revenue,
      unitsSold: totalUnits,
      cogs,
      recipeDeltas: Object.fromEntries(needsTotal)
    };

    state.sales.push(sale);

    // reset UI draft packs
    saleDraftPacks = [];
    renderSaleDraftPacks();

    // reset minimal fields (on garde date/heure)
    if ($("vente-lieu")) $("vente-lieu").value = "";
    if ($("vente-unites")) $("vente-unites").value = "0";

    saveState();
    renderSalesOfDay();
    renderDashboard();
    renderHistorique();
    refreshSalePackSelect();
    toast("Vente enregistrée ✅");
  }

  function renderSalesOfDay() {
    const box = $("vente-liste-container");
    if (!box) return;

    const chosenDate = $("vente-date")?.value || dateISO();
    const list = state.sales.filter(s => s.date === chosenDate).sort((a, b) => String(b.ts).localeCompare(String(a.ts)));

    if (!list.length) {
      box.innerHTML = "<em>Aucune vente pour cette date.</em>";
      return;
    }

    const wrap = el("div");
    for (const s of list) {
      const packLines = (s.packs || []).map(p => `• ${p.qty} × ${p.name} = ${money(p.total)}`).join("<br>");
      const card = el("div", { class: "card", style: "margin:10px 0;" }, [
        el("div", { style: "display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;" }, [
          el("div", {}, [
            el("strong", {}, [`${s.time} — ${s.vendorName}`]),
            el("div", { class: "small", style: "opacity:.9;" }, [s.lieu ? `Lieu : ${s.lieu}` : ""]),
            el("div", { class: "small", style: "opacity:.9;" , html: packLines ? `Packs :<br>${packLines}` : "Packs : -"}),
            el("div", { class: "small", style: "opacity:.9;" }, [
              `Unités hors pack : ${s.unitsSolo} × ${money(s.unitPrice)} = ${money(s.unitsSolo * s.unitPrice)}`
            ]),
            el("div", { class: "small", style: "opacity:.9;" }, [`Total : ${money(s.revenue)} • ${s.unitsSold} unités`])
          ]),
          el("button", { class: "btn btn-pink", type: "button", onclick: () => deleteSale(s.id) }, ["Supprimer"])
        ])
      ]);
      wrap.appendChild(card);
    }

    box.innerHTML = "";
    box.appendChild(wrap);
  }

  function deleteSale(id) {
    const s = state.sales.find(x => x.id === id);
    if (!s) return;

    if (!confirm("Supprimer cette vente va remettre les produits finis en stock. Continuer ?")) return;

    // remettre unités (au coût moyen au moment de la suppression: on remet COGS)
    state.inventory.finishedUnits += Math.max(0, Math.floor(toNum(s.unitsSold, 0)));
    state.inventory.finishedValue += Math.max(0, toNum(s.cogs, 0));

    // remettre stocks par production (si la vente a été enregistrée avec des deltas)
    if (s.recipeDeltas && typeof s.recipeDeltas === "object") {
      for (const [rid, u] of Object.entries(s.recipeDeltas)) {
        const r = state.recipes.find(x => x.id === rid);
        if (!r) continue;
        const add = Math.max(0, Math.floor(toNum(u, 0)));
        r.remainingQty = recipeRemainingUnits(r) + add;
      }
    }

    state.sales = state.sales.filter(x => x.id !== id);
    saveState();
    renderSalesOfDay();
    renderDashboard();
    renderHistorique();
    refreshSalePackSelect();
    toast("Vente supprimée.");
  }

  /* =========================
     10) Dépenses
  ========================== */
  function resetExpenseForm() {
    if ($("dep-index")) $("dep-index").value = "-1";
    if ($("dep-cat")) $("dep-cat").value = "";
    if ($("dep-montant")) $("dep-montant").value = "";
    if ($("dep-note")) $("dep-note").value = "";
    if ($("btn-add-depense")) $("btn-add-depense").textContent = "Enregistrer la dépense";
  }

  function saveExpense() {
    const idx = toNum($("dep-index")?.value, -1);
    const date = $("dep-date")?.value || dateISO();
    const cat = safeText($("dep-cat")?.value);
    const amount = Math.round(toNum($("dep-montant")?.value, 0));
    const note = safeText($("dep-note")?.value);

    if (!cat) return toast("Catégorie manquante.");
    if (amount <= 0) return toast("Montant invalide.");

    if (idx >= 0 && idx < state.expenses.length) {
      const e = state.expenses[idx];
      e.date = date; e.cat = cat; e.amount = amount; e.note = note;
      e.ts = new Date(`${date}T00:00:00`).toISOString();
      toast("Dépense modifiée ✅");
    } else {
      state.expenses.push({
        id: uid(),
        date, cat, amount, note,
        ts: new Date(`${date}T00:00:00`).toISOString()
      });
      toast("Dépense enregistrée ✅");
    }

    saveState();
    renderExpenses();
    renderDashboard();
    renderHistorique();
    resetExpenseForm();
  }

  function renderExpenses() {
    const box = $("depenses-list");
    if (!box) return;

    if (!state.expenses.length) {
      box.innerHTML = "<em>Aucune dépense enregistrée.</em>";
      return;
    }

    const list = [...state.expenses].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    const wrap = el("div");

    list.forEach((e, idx) => {
      wrap.appendChild(
        el("div", { class: "card", style: "margin:8px 0;padding:10px;" }, [
          el("div", { style: "display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;" }, [
            el("div", {}, [
              el("strong", {}, [`${e.date} — ${e.cat}`]),
              el("div", { class: "small", style: "opacity:.9;" }, [`Montant : ${money(e.amount)}`]),
              el("div", { class: "small", style: "opacity:.9;" }, [e.note ? `Note : ${e.note}` : ""])
            ]),
            el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;" }, [
              el("button", { class: "btn btn-secondary", type: "button", onclick: () => editExpense(idx) }, ["Modifier"]),
              el("button", { class: "btn btn-pink", type: "button", onclick: () => deleteExpense(e.id) }, ["Supprimer"])
            ])
          ])
        ])
      );
    });

    box.innerHTML = "";
    box.appendChild(wrap);
  }

  function editExpense(index) {
    const e = state.expenses[index];
    if (!e) return;
    if ($("dep-index")) $("dep-index").value = String(index);
    if ($("dep-date")) $("dep-date").value = e.date || dateISO();
    if ($("dep-cat")) $("dep-cat").value = e.cat || "";
    if ($("dep-montant")) $("dep-montant").value = String(e.amount ?? "");
    if ($("dep-note")) $("dep-note").value = e.note || "";
    if ($("btn-add-depense")) $("btn-add-depense").textContent = "Modifier la dépense";
  }

  function deleteExpense(id) {
    if (!confirm("Supprimer cette dépense ?")) return;
    state.expenses = state.expenses.filter(e => e.id !== id);
    saveState();
    renderExpenses();
    renderDashboard();
    renderHistorique();
  }

  /* =========================
     11) Dashboard
  ========================== */
  function renderDashboard() {
    applyConfigLabels();

    const totalUnitsSold = state.sales.reduce((s, x) => s + Math.max(0, Math.floor(toNum(x.unitsSold, 0))), 0);
    const revenueTotal = state.sales.reduce((s, x) => s + toNum(x.revenue, 0), 0);
    const expensesTotal = state.expenses.reduce((s, x) => s + toNum(x.amount, 0), 0);
    const cogsTotal = state.sales.reduce((s, x) => s + toNum(x.cogs, 0), 0);

    const net = revenueTotal - expensesTotal - cogsTotal;

    if ($("dash-total-gaufres")) $("dash-total-gaufres").textContent = String(totalUnitsSold);
    if ($("dash-revenu-total")) $("dash-revenu-total").textContent = money(revenueTotal);
    if ($("dash-depenses")) $("dash-depenses").textContent = money(expensesTotal);
    if ($("dash-benefice-net")) $("dash-benefice-net").textContent = money(net);

    // Perte alimentaire (PERTE) mois en cours (stock pro)
    if ($("dash-waste-month")) {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const wasteCost = (state.stockMovements || []).filter(x => x.type === "PERTE").reduce((s, x) => {
        const d = new Date(x.ts || "");
        if (isNaN(d.getTime())) return s;
        if (d.getFullYear() !== y || d.getMonth() !== m) return s;
        return s + toNum(x.costTotal, 0);
      }, 0);
      $("dash-waste-month").textContent = money(wasteCost);
    }

    const pP = state.config.produitP || "produits";
    if ($("dash-stock-restant")) $("dash-stock-restant").textContent = `${Math.floor(toNum(state.inventory.finishedUnits, 0))} ${pP}`;

    // capacité: max sur toutes les recettes (combien on peut produire avec stocks)
    let bestCap = 0;
    let bestRecipe = null;
    for (const r of state.recipes) {
      const cap = computeRecipeCapacity(r);
      if (cap > bestCap) { bestCap = cap; bestRecipe = r; }
    }
    if ($("dash-capacite")) $("dash-capacite").textContent = `${bestCap} ${pP}`;

    // meilleur vendeur
    const byVendor = new Map();
    for (const s of state.sales) {
      const k = s.vendorName || "-";
      byVendor.set(k, (byVendor.get(k) || 0) + toNum(s.revenue, 0));
    }
    const bestVendor = [...byVendor.entries()].sort((a, b) => b[1] - a[1])[0];
    if ($("dash-best-vendeur")) $("dash-best-vendeur").textContent = bestVendor ? `${bestVendor[0]} (${money(bestVendor[1])})` : "-";

    // pack le plus vendu
    const byPack = new Map();
    for (const s of state.sales) {
      for (const p of (s.packs || [])) {
        const k = p.name || "-";
        byPack.set(k, (byPack.get(k) || 0) + Math.max(0, Math.floor(toNum(p.qty, 0))));
      }
    }
    const bestPack = [...byPack.entries()].sort((a, b) => b[1] - a[1])[0];
    if ($("dash-best-pack")) $("dash-best-pack").textContent = bestPack ? `${bestPack[0]} (${bestPack[1]})` : "-";

    // stats avancées
    const avgCost = inventoryAvgCost();
    const invValue = toNum(state.inventory.finishedValue, 0);

    if ($("dash-stats-ventes")) $("dash-stats-ventes").textContent =
      `Analyse ventes : ${state.sales.length} vente(s), panier moyen ${money(state.sales.length ? (revenueTotal / state.sales.length) : 0)}, coût moyen/unité ${roundSmart(avgCost)} FCFA`;

    // ingrédient le plus "cher" en valeur de stock
    const topIng = [...state.ingredients]
      .map(i => ({ name: i.name, value: ingredientStockValue(i) }))
      .sort((a, b) => b.value - a.value)[0];

    if ($("dash-stats-ingredients")) $("dash-stats-ingredients").textContent =
      `Analyse ingrédients : valeur stock produits finis ${money(invValue)}${bestRecipe ? ` • meilleure capacité via "${bestRecipe.name}"` : ""}${topIng ? ` • ingrédient le + valorisé: ${topIng.name} (${money(topIng.value)})` : ""}`;
  }

  function resetFinishedStock() {
    if (!confirm("Réinitialiser le stock de produits finis (unités + valeur) ?")) return;
    state.inventory.finishedUnits = 0;
    state.inventory.finishedValue = 0;
    saveState();
    renderDashboard();
    toast("Stock produits finis réinitialisé.");
  }

  /* =========================
     12) Historique + exports
  ========================== */
  function renderHistorique() {
    const box = $("historique-list");
    if (!box) return;

    const sales = [...state.sales].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    const expenses = [...state.expenses].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));

    if (!sales.length && !expenses.length) {
      box.innerHTML = "<em>Aucune donnée d'historique.</em>";
      return;
    }

    const wrap = el("div");

    // ventes
    wrap.appendChild(el("h2", {}, ["Ventes"]));
    if (!sales.length) wrap.appendChild(el("div", { class: "card", style: "margin:8px 0;padding:10px;" }, ["Aucune vente."]));
    for (const s of sales) {
      const packsHTML = (s.packs || []).map(p => `• ${p.qty} × ${escapeHTML(p.name)} = ${money(p.total)}`).join("<br>");
      wrap.appendChild(
        el("div", { class: "card", style: "margin:10px 0;" }, [
          el("strong", {}, [`${s.date} ${s.time} — ${s.vendorName}`]),
          el("div", { class: "small", style: "opacity:.9;" }, [s.lieu ? `Lieu : ${s.lieu}` : ""]),
          el("div", { class: "small", style: "opacity:.9;" , html: packsHTML ? `Packs :<br>${packsHTML}` : "Packs : -"}),
          el("div", { class: "small", style: "opacity:.9;" }, [
            `Unités hors pack : ${s.unitsSolo} × ${money(s.unitPrice)}`
          ]),
          el("div", { class: "small", style: "opacity:.9;" }, [
            `Total : ${money(s.revenue)} • Unités : ${s.unitsSold} • COGS : ${money(s.cogs)}`
          ])
        ])
      );
    }

    // dépenses
    wrap.appendChild(el("h2", { style: "margin-top:18px;" }, ["Dépenses"]));
    if (!expenses.length) wrap.appendChild(el("div", { class: "card", style: "margin:8px 0;padding:10px;" }, ["Aucune dépense."]));
    for (const e of expenses) {
      wrap.appendChild(
        el("div", { class: "card", style: "margin:10px 0;" }, [
          el("strong", {}, [`${e.date} — ${e.cat}`]),
          el("div", { class: "small", style: "opacity:.9;" }, [`Montant : ${money(e.amount)}`]),
          el("div", { class: "small", style: "opacity:.9;" }, [e.note ? `Note : ${e.note}` : ""])
        ])
      );
    }

    box.innerHTML = "";
    box.appendChild(wrap);
  }

  async function exportPDF() {
    const node = $("page-historique");
    if (!node) return toast("Section historique introuvable.");

    // jsPDF / html2canvas sont chargés dans le HTML. Si pas dispo: fallback print.
    const hasCanvas = typeof window.html2canvas === "function";
    const hasPDF = window.jspdf && window.jspdf.jsPDF;

    if (!hasCanvas || !hasPDF) {
      toast("Librairies PDF non disponibles. Fallback impression.");
      window.print();
      return;
    }

    toast("Génération PDF…");

    const canvas = await window.html2canvas(node, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL("image/png");

    const pdf = new window.jspdf.jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // ratio image
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(`businessfood-historique-${dateISO()}.pdf`);
  }
  window.exportPDF = exportPDF;

  function exportCSV() {
    const lines = [];
    lines.push(["type", "date", "heure", "vendeur", "lieu", "unites_hors_pack", "prix_unite", "packs", "revenu", "cogs", "depense_cat", "depense_montant", "depense_note"].join(";"));

    // ventes
    for (const s of state.sales) {
      const packs = (s.packs || []).map(p => `${p.qty}x ${p.name} (${p.pricePerPack})`).join(" | ");
      lines.push([
        "vente",
        s.date || "",
        s.time || "",
        (s.vendorName || "").replaceAll(";", ","),
        (s.lieu || "").replaceAll(";", ","),
        String(s.unitsSolo ?? 0),
        String(s.unitPrice ?? 0),
        packs.replaceAll(";", ","),
        String(Math.round(toNum(s.revenue, 0))),
        String(Math.round(toNum(s.cogs, 0))),
        "", "", ""
      ].join(";"));
    }

    // dépenses
    for (const e of state.expenses) {
      lines.push([
        "depense",
        e.date || "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        (e.cat || "").replaceAll(";", ","),
        String(Math.round(toNum(e.amount, 0))),
        (e.note || "").replaceAll(";", ",")
      ].join(";"));
    }

    downloadText(`businessfood-export-${dateISO()}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
  }
  window.exportCSV = exportCSV;

  function whatsappShare(text) {
    const msg = encodeURIComponent(text);
    const url = `https://wa.me/?text=${msg}`;
    window.open(url, "_blank");
  }

  function shareWhatsapp() {
    const d = dateISO();
    const salesToday = state.sales.filter(s => s.date === d);
    const rev = salesToday.reduce((s, x) => s + toNum(x.revenue, 0), 0);
    const units = salesToday.reduce((s, x) => s + Math.floor(toNum(x.unitsSold, 0)), 0);

    const pP = state.config.produitP || "produits";
    const msg =
      `BusinessFood Manager — Résumé du ${d}\n` +
      `Ventes: ${salesToday.length}\n` +
      `Unités vendues: ${units} ${pP}\n` +
      `Chiffre d'affaires: ${money(rev)}\n` +
      `Stock restant: ${Math.floor(toNum(state.inventory.finishedUnits, 0))} ${pP}\n`;

    whatsappShare(msg);
  }
  window.shareWhatsapp = shareWhatsapp;

  function shareDashboard() {
    const revenueTotal = state.sales.reduce((s, x) => s + toNum(x.revenue, 0), 0);
    const expensesTotal = state.expenses.reduce((s, x) => s + toNum(x.amount, 0), 0);
    const cogsTotal = state.sales.reduce((s, x) => s + toNum(x.cogs, 0), 0);
    const net = revenueTotal - expensesTotal - cogsTotal;

    const msg =
      `BusinessFood Manager — Dashboard\n` +
      `Revenu total: ${money(revenueTotal)}\n` +
      `Dépenses: ${money(expensesTotal)}\n` +
      `Coût marchandises (COGS): ${money(cogsTotal)}\n` +
      `Bénéfice net: ${money(net)}\n` +
      `Stock produits finis: ${Math.floor(toNum(state.inventory.finishedUnits, 0))}\n`;

    whatsappShare(msg);
  }
  window.shareDashboard = shareDashboard;

  /* =========================
     13) Init + wiring
  ========================== */
  function initDefaults() {
    // dates/heure par défaut
    if ($("vente-date") && !$("vente-date").value) $("vente-date").value = dateISO();
    if ($("vente-heure") && !$("vente-heure").value) $("vente-heure").value = timeISO();
    if ($("dep-date") && !$("dep-date").value) $("dep-date").value = dateISO();

    // draft init
    refreshPackRecipeOptions();
    renderPackDraft();
    renderRecipeDraftList();
    renderSaleDraftPacks();

    // labels
    applyConfigLabels();
    ensureRecipeCancelButton();
    setRecipeFormMode(false);
  }

  function wireEvents() {
    on($("btn-open-config-home"), "click", () => showPage("config"));
    on($("btn-save-config"), "click", saveConfig);

    on($("btn-add-ingredient"), "click", addIngredient);

    // Stock Pro: mode démo
    on($("btn-seed-demo-stock"), "click", seedDemoStockProfile);
    on($("btn-delete-demo-stock"), "click", deleteDemoStockProfile);

    on($("rec-add-ingredient-btn"), "click", addIngredientToRecipeDraft);
    on($("btn-save-recipe"), "click", saveRecipeProduction);

    on($("btn-pack-add-row"), "click", addPackRow);
    on($("btn-add-pack"), "click", addPack);

    // Pack: suggestion prix en live (marge -> placeholder)
    on($("pack-margin"), "input", renderPackDraft);
    on($("pack-margin"), "change", renderPackDraft);


    on($("vente-pack-add-btn"), "click", addPackToSaleDraft);
    on($("btn-enregistrer-vente"), "click", saveSale);
    on($("vente-date"), "change", renderSalesOfDay);

    on($("btn-add-depense"), "click", saveExpense);
    on($("btn-cancel-depense-edit"), "click", resetExpenseForm);

    on($("btn-reset-stock"), "click", resetFinishedStock);

    // vendeurs list refresh
    renderVendors();
  }

  function boot() {
    migrateStateToV4();
    initDefaults();
    wireEvents();

    // initial renders
    renderIngredients();
    refreshRecipeIngredientSelect();
    refreshPackRecipeOptions();
    renderPackDraft();
    renderPacks();
    refreshSalePackSelect();
    refreshVendorsSelect();
    renderSalesOfDay();
    renderExpenses();
    renderDashboard();
    renderHistorique();

    // Page d'accueil par défaut
    showPage("home");
  }

  document.addEventListener("DOMContentLoaded", boot);

})();
