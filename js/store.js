/*
 * Data layer. Every read/write goes through this object and returns a Promise,
 * even though today it's backed by localStorage + static JSON files. That
 * means a future cloud-sync backend can replace the internals of these
 * functions without touching any calling code in app.js.
 */
const Store = (() => {
  const LS_PREFIX = "macrokit:";
  const KEYS = {
    customRecipes: LS_PREFIX + "customRecipes",
    customIngredients: LS_PREFIX + "customIngredients",
    apiKey: LS_PREFIX + "anthropicApiKey",
    plans: LS_PREFIX + "plans", // { [weekStartISO]: { slots: {...} } }
    shoppingChecked: LS_PREFIX + "shoppingChecked", // { [weekStartISO]: { [itemKey]: true } }
    targets: LS_PREFIX + "targets",
    shoppingLists: LS_PREFIX + "shoppingLists",
    settings: LS_PREFIX + "settings",
  };

  const DEFAULT_TARGETS = { kcal: 1880, protein: 160, fat: 42, carbs: 216 };
  const DEFAULT_SETTINGS = { familyMultiplier: 1, lastWeekStart: null };

  let _ingredients = null; // { byId: {...}, list: [...] }
  let _seedRecipes = null;
  let _loadPromise = null;
  let _sharedConfig = null;
  let _sharedConfigPromise = null;
  let _sharedRecipesCache = null; // cached per session so we don't refetch on every getAllRecipes() call

  function readLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn("Store: failed to read", key, e);
      return fallback;
    }
  }

  function writeLS(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error("Store: failed to write", key, e);
      return false;
    }
  }

  async function loadSeedData() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = (async () => {
      const [ingredientsRes, recipesRes] = await Promise.all([
        fetch("data/ingredients.json"),
        fetch("data/recipes.json"),
      ]);
      const ingredientsJson = await ingredientsRes.json();
      const recipesJson = await recipesRes.json();

      const byId = {};
      ingredientsJson.ingredients.forEach((ing) => (byId[ing.id] = ing));
      _ingredients = { byId, list: ingredientsJson.ingredients };
      _seedRecipes = recipesJson.map((r) => ({ ...r, source: "seed" }));
    })();
    return _loadPromise;
  }

  async function getIngredients() {
    await loadSeedData();
    const custom = readLS(KEYS.customIngredients, []);
    if (!custom.length) return _ingredients;
    const byId = { ..._ingredients.byId };
    custom.forEach((ing) => (byId[ing.id] = ing));
    return { byId, list: [..._ingredients.list, ...custom] };
  }

  async function getApiKey() {
    return readLS(KEYS.apiKey, "");
  }

  async function saveApiKey(key) {
    writeLS(KEYS.apiKey, key || "");
    return key || "";
  }

  async function getCustomIngredients() {
    return readLS(KEYS.customIngredients, []);
  }

  async function saveCustomIngredient(ingredient) {
    const list = readLS(KEYS.customIngredients, []);
    const idx = list.findIndex((i) => i.id === ingredient.id);
    if (idx >= 0) list[idx] = ingredient;
    else list.push(ingredient);
    writeLS(KEYS.customIngredients, list);
    return ingredient;
  }

  async function getSeedRecipes() {
    await loadSeedData();
    return _seedRecipes;
  }

  async function getCustomRecipes() {
    return readLS(KEYS.customRecipes, []).map((r) => ({ ...r, source: r.source || "custom" }));
  }

  async function loadSharedConfig() {
    if (_sharedConfigPromise) return _sharedConfigPromise;
    _sharedConfigPromise = (async () => {
      try {
        const res = await fetch("data/shared-config.json");
        _sharedConfig = await res.json();
      } catch (e) {
        _sharedConfig = { apiUrl: "" };
      }
    })();
    return _sharedConfigPromise;
  }

  async function getSharedRecipes() {
    if (_sharedRecipesCache) return _sharedRecipesCache;
    await loadSharedConfig();
    if (!_sharedConfig.apiUrl) {
      _sharedRecipesCache = [];
      return _sharedRecipesCache;
    }
    try {
      const res = await fetch(_sharedConfig.apiUrl);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error("bad shared response");
      _sharedRecipesCache = rows.map((r) => ({ ...r, source: "shared" }));
    } catch (e) {
      console.warn("Store: failed to load shared recipes", e);
      _sharedRecipesCache = [];
    }
    return _sharedRecipesCache;
  }

  // Posts a recipe to the shared Google Sheet backend, if configured. Never
  // throws — callers get back { ok, configured } and decide how to tell the
  // user, so a sync failure never blocks the recipe's local save.
  async function postSharedRecipe(recipe) {
    await loadSharedConfig();
    if (!_sharedConfig.apiUrl) return { ok: false, configured: false };
    try {
      const res = await fetch(_sharedConfig.apiUrl, {
        method: "POST",
        body: JSON.stringify({ recipe }),
      });
      const data = await res.json();
      if (data && data.ok) {
        _sharedRecipesCache = null; // invalidate so the next load picks up the new row
        return { ok: true, configured: true };
      }
      return { ok: false, configured: true, error: data && data.error };
    } catch (e) {
      return { ok: false, configured: true, error: String(e) };
    }
  }

  async function getAllRecipes() {
    const [seed, custom, shared] = await Promise.all([getSeedRecipes(), getCustomRecipes(), getSharedRecipes()]);
    const localIds = new Set(custom.map((r) => r.id));
    const sharedDeduped = shared.filter((r) => !localIds.has(r.id));
    return [...seed, ...custom, ...sharedDeduped];
  }

  async function getRecipeById(id) {
    const all = await getAllRecipes();
    return all.find((r) => r.id === id) || null;
  }

  async function saveCustomRecipe(recipe) {
    const list = readLS(KEYS.customRecipes, []);
    const idx = list.findIndex((r) => r.id === recipe.id);
    if (idx >= 0) list[idx] = recipe;
    else list.push(recipe);
    writeLS(KEYS.customRecipes, list);
    return recipe;
  }

  async function deleteCustomRecipe(id) {
    const list = readLS(KEYS.customRecipes, []).filter((r) => r.id !== id);
    writeLS(KEYS.customRecipes, list);
  }

  // Plans are keyed by ISO Monday date of the week, e.g. "2026-09-14".
  // slots key format: "dayIndex:mealType" (dayIndex 0=Mon..6=Sun) -> [recipeId, ...]
  async function getPlan(weekStart) {
    const all = readLS(KEYS.plans, {});
    return all[weekStart] || { weekStart, slots: {} };
  }

  async function savePlan(weekStart, planData) {
    const all = readLS(KEYS.plans, {});
    all[weekStart] = planData;
    writeLS(KEYS.plans, all);
    return planData;
  }

  async function getShoppingChecked(weekStart) {
    const all = readLS(KEYS.shoppingChecked, {});
    return all[weekStart] || {};
  }

  async function saveShoppingChecked(weekStart, checkedMap) {
    const all = readLS(KEYS.shoppingChecked, {});
    all[weekStart] = checkedMap;
    writeLS(KEYS.shoppingChecked, all);
  }

  async function getTargets() {
    return readLS(KEYS.targets, DEFAULT_TARGETS);
  }

  async function saveTargets(targets) {
    writeLS(KEYS.targets, targets);
    return targets;
  }

  async function getSettings() {
    return { ...DEFAULT_SETTINGS, ...readLS(KEYS.settings, {}) };
  }

  async function saveSettings(settings) {
    const merged = { ...(await getSettings()), ...settings };
    writeLS(KEYS.settings, merged);
    return merged;
  }

  async function getShoppingLists() {
    return readLS(KEYS.shoppingLists, []);
  }

  async function saveShoppingList(list) {
    const all = readLS(KEYS.shoppingLists, []);
    const idx = all.findIndex((l) => l.id === list.id);
    if (idx >= 0) all[idx] = list;
    else all.unshift(list);
    writeLS(KEYS.shoppingLists, all.slice(0, 20));
    return list;
  }

  async function deleteShoppingList(id) {
    const all = readLS(KEYS.shoppingLists, []).filter((l) => l.id !== id);
    writeLS(KEYS.shoppingLists, all);
  }

  return {
    DEFAULT_TARGETS,
    getIngredients,
    getCustomIngredients,
    saveCustomIngredient,
    getApiKey,
    saveApiKey,
    getSeedRecipes,
    getCustomRecipes,
    getSharedRecipes,
    postSharedRecipe,
    getAllRecipes,
    getRecipeById,
    saveCustomRecipe,
    deleteCustomRecipe,
    getPlan,
    savePlan,
    getShoppingChecked,
    saveShoppingChecked,
    getTargets,
    saveTargets,
    getSettings,
    saveSettings,
    getShoppingLists,
    saveShoppingList,
    deleteShoppingList,
  };
})();
