const App = (() => {
  const viewEl = document.getElementById("view");
  const titleEl = document.getElementById("topbar-title");
  const actionsEl = document.getElementById("topbar-actions");
  const tabbarEl = document.getElementById("tabbar");

  let recipesCache = null;
  let ingredientsCache = null;

  // Recipes-tab UI state persists across navigating away/back within a session.
  const recipesState = {
    query: "",
    category: null, // single-select quick filter
    proteinSources: new Set(),
    carbSources: new Set(),
  };

  // Planner/Shopping share the same active week + selected day within a session.
  const plannerState = {
    weekStart: null, // ISO date, set on first load
    activeDay: 0,
  };

  const addRecipeState = {
    name: "",
    category: "",
    proteinSource: "",
    carbSource: "",
    servings: "1",
    ingredients: [],
    instructions: [""],
    macros: { kcal: "", protein: "", carbs: "", fat: "" },
  };

  let healthifyApiKey; // undefined = not loaded yet, "" = no key, string = has key
  const healthifyState = {
    inputText: "",
    url: "",
    loading: false,
    error: null,
    result: null,
  };

  const gapFinderState = {
    protein: "",
    carbs: "",
    fat: "",
    category: null,
    proteinSources: new Set(),
    carbSources: new Set(),
    target: null,
    results: null,
  };

  async function ensureData() {
    if (!recipesCache) recipesCache = await Store.getAllRecipes();
    if (!ingredientsCache) ingredientsCache = await Store.getIngredients();
    return { recipes: recipesCache, ingredients: ingredientsCache };
  }

  async function invalidateRecipes() {
    recipesCache = await Store.getAllRecipes();
  }

  function recipesById(recipeList) {
    const map = {};
    recipeList.forEach((r) => (map[r.id] = r));
    return map;
  }

  async function ensureActiveWeek() {
    if (plannerState.weekStart) return plannerState.weekStart;
    const settings = await Store.getSettings();
    const today = Util.toISODate(Util.startOfWeek(new Date()));
    plannerState.weekStart = settings.lastWeekStart || today;
    const dates = Util.getWeekDates(plannerState.weekStart);
    const todayISO = Util.toISODate(new Date());
    const idx = dates.findIndex((d) => Util.toISODate(d) === todayISO);
    plannerState.activeDay = idx >= 0 ? idx : 0;
    return plannerState.weekStart;
  }

  function showToast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  // ---------------- Router ----------------
  function parseHash() {
    const hash = location.hash.replace(/^#\/?/, "");
    const parts = hash.split("/").filter(Boolean);
    return { name: parts[0] || "recipes", params: parts.slice(1) };
  }

  function navigate(path) {
    location.hash = path;
  }

  async function router() {
    const { name, params } = parseHash();
    setActiveTab(name);
    actionsEl.innerHTML = "";
    window.scrollTo(0, 0);

    switch (name) {
      case "recipes":
        titleEl.textContent = "MacroKit";
        await renderRecipesView();
        break;
      case "recipe":
        await renderRecipeDetailView(params[0]);
        break;
      case "add-recipe":
        titleEl.textContent = "New Recipe";
        await renderAddRecipeView();
        break;
      case "healthify":
        titleEl.textContent = "Healthify My Recipe";
        await renderHealthifyView();
        break;
      case "planner":
        titleEl.textContent = "Weekly Planner";
        await renderPlannerView();
        break;
      case "shopping":
        titleEl.textContent = "Shopping List";
        await renderShoppingView();
        break;
      case "gap-finder":
        titleEl.textContent = "Macro Gap Finder";
        await renderGapFinderView();
        break;
      case "more":
        titleEl.textContent = "More";
        renderMoreView();
        break;
      default:
        navigate("recipes");
    }
  }

  function setActiveTab(routeName) {
    const topLevel = routeName === "recipe" ? "recipes" : routeName;
    [...tabbarEl.querySelectorAll("button")].forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.route === topLevel);
    });
  }

  function renderPlaceholder(icon, title, body) {
    viewEl.innerHTML = `
      <div class="placeholder-view">
        <div class="big-icon">${icon}</div>
        <h2>${title}</h2>
        <p style="margin-top:8px">${body}</p>
      </div>
    `;
  }

  function renderMoreView() {
    viewEl.innerHTML = `
      <div class="section-title">Your data</div>
      <div class="card" style="display:flex;flex-direction:column;gap:2px;padding:4px;">
        ${moreRow("➕", "Add a custom recipe", "add-recipe")}
        ${moreRow("✨", "Healthify a recipe", "healthify")}
        ${moreRow("🎯", "Macro targets", "settings")}
      </div>
      <div class="section-title">About</div>
      <div class="card">
        <p style="font-size:13.5px;color:var(--color-text-dim);line-height:1.5">
          MacroKit stores everything on this device — your weekly plan, custom recipes, and targets
          persist across visits with no account required.
        </p>
      </div>
    `;
    viewEl.querySelectorAll("[data-more]").forEach((el) => {
      el.addEventListener("click", () => {
        const target = el.dataset.more;
        if (target === "settings") return openTargetsEditor();
        if (target === "add-recipe") return navigate("add-recipe");
        if (target === "healthify") return navigate("healthify");
      });
    });
  }

  function moreRow(icon, label, key) {
    return `
      <button data-more="${key}" style="all:unset;display:flex;align-items:center;gap:12px;padding:14px 10px;min-height:var(--tap-min);cursor:pointer;">
        <span style="font-size:18px">${icon}</span>
        <span style="flex:1;font-size:15px;font-weight:500">${label}</span>
        <span style="color:var(--color-text-dim)">›</span>
      </button>
    `;
  }

  // ---------------- Recipes: browse/filter ----------------
  async function renderRecipesView() {
    viewEl.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">
      <div class="skeleton" style="height:44px"></div>
      <div class="skeleton" style="height:120px"></div>
    </div>`;
    const { recipes, ingredients } = await ensureData();
    paintRecipesView(recipes, ingredients);
  }

  function matchesFilters(recipe) {
    const q = recipesState.query.trim().toLowerCase();
    if (q && !recipe.name.toLowerCase().includes(q)) return false;
    if (recipesState.category && recipe.category !== recipesState.category) return false;
    if (recipesState.proteinSources.size && !recipesState.proteinSources.has(recipe.proteinSource)) return false;
    if (recipesState.carbSources.size && !recipesState.carbSources.has(recipe.carbSource)) return false;
    return true;
  }

  function paintRecipesView(allRecipes) {
    const filtered = allRecipes.filter(matchesFilters);
    const activeFilterCount = recipesState.proteinSources.size + recipesState.carbSources.size;

    viewEl.innerHTML = `
      <div class="search-row">
        <input type="text" class="search-input" id="search-input" placeholder="Search ${allRecipes.length} recipes…" value="${Util.escapeHtml(recipesState.query)}" />
        <button class="icon-btn" id="filters-btn" aria-label="Filters">🎚️${activeFilterCount ? `<span style="position:absolute;transform:translate(10px,-10px);background:var(--color-danger);color:#fff;border-radius:999px;font-size:9px;padding:1px 5px;">${activeFilterCount}</span>` : ""}</button>
      </div>
      <div class="filter-chip-row" id="category-chips">
        <div class="chip ${recipesState.category === null ? "active" : ""}" data-cat="">All</div>
        ${Util.CATEGORIES.map(
          (c) => `<div class="chip ${recipesState.category === c ? "active" : ""}" data-cat="${c}">${Util.CATEGORY_ICONS[c]} ${Util.CATEGORY_LABELS[c]}</div>`
        ).join("")}
      </div>
      <div id="recipe-results"></div>
      <button class="fab" id="add-recipe-fab" aria-label="Add custom recipe">+</button>
    `;

    viewEl.querySelector("#add-recipe-fab").addEventListener("click", () => navigate("add-recipe"));

    const resultsEl = viewEl.querySelector("#recipe-results");
    if (!filtered.length) {
      resultsEl.innerHTML = `<div class="empty-state">No recipes match your search/filters.<br/>Try clearing a filter.</div>`;
    } else {
      resultsEl.innerHTML = `<div class="recipe-grid">${filtered.map(recipeCardHtml).join("")}</div>`;
    }

    // Search
    const searchInput = viewEl.querySelector("#search-input");
    searchInput.addEventListener(
      "input",
      Util.debounce((e) => {
        recipesState.query = e.target.value;
        paintRecipesView(allRecipes);
        // refocus + keep cursor position after re-render
        const el = viewEl.querySelector("#search-input");
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }, 180)
    );

    // Category chips
    viewEl.querySelector("#category-chips").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-cat]");
      if (!chip) return;
      const cat = chip.dataset.cat;
      recipesState.category = recipesState.category === cat ? null : cat || null;
      if (chip.dataset.cat === "") recipesState.category = null;
      paintRecipesView(allRecipes);
    });

    // Filters sheet
    viewEl.querySelector("#filters-btn").addEventListener("click", () => openFilterSheet(allRecipes));

    // Recipe card click
    resultsEl.addEventListener("click", (e) => {
      const card = e.target.closest("[data-recipe-id]");
      if (!card) return;
      navigate(`recipe/${card.dataset.recipeId}`);
    });
  }

  function recipeCardHtml(r) {
    return `
      <div class="recipe-card" data-recipe-id="${r.id}">
        <span class="cat-tag">${Util.CATEGORY_ICONS[r.category] || ""} ${Util.CATEGORY_LABELS[r.category] || r.category}</span>
        <span class="name">${Util.escapeHtml(r.name)}</span>
        <div class="macro-row">
          <span class="macro-pill kcal">${Math.round(r.macros.kcal)} kcal</span>
          <span class="macro-pill protein">${Math.round(r.macros.protein)}p</span>
          <span class="macro-pill carbs">${Math.round(r.macros.carbs)}c</span>
          <span class="macro-pill fat">${Math.round(r.macros.fat)}f</span>
        </div>
      </div>
    `;
  }

  function openFilterSheet(allRecipes) {
    const backdrop = document.createElement("div");
    backdrop.className = "filter-sheet-backdrop";
    const tempProtein = new Set(recipesState.proteinSources);
    const tempCarb = new Set(recipesState.carbSources);

    function optionsHtml(list, labels, selectedSet) {
      return `<div class="filter-options">${list
        .map((v) => `<div class="chip ${selectedSet.has(v) ? "active" : ""}" data-v="${v}">${labels[v]}</div>`)
        .join("")}</div>`;
    }

    backdrop.innerHTML = `
      <div class="filter-sheet">
        <h3>Protein source</h3>
        <div id="protein-opts">${optionsHtml(Util.PROTEIN_SOURCES, Util.PROTEIN_SOURCE_LABELS, tempProtein)}</div>
        <h3>Carb source</h3>
        <div id="carb-opts">${optionsHtml(Util.CARB_SOURCES, Util.CARB_SOURCE_LABELS, tempCarb)}</div>
        <div style="display:flex;gap:10px;margin-top:20px;">
          <button class="btn secondary" id="clear-filters" style="flex:1">Clear</button>
          <button class="btn" id="apply-filters" style="flex:2">Apply</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    backdrop.querySelector("#protein-opts").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-v]");
      if (!chip) return;
      const v = chip.dataset.v;
      tempProtein.has(v) ? tempProtein.delete(v) : tempProtein.add(v);
      chip.classList.toggle("active");
    });
    backdrop.querySelector("#carb-opts").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-v]");
      if (!chip) return;
      const v = chip.dataset.v;
      tempCarb.has(v) ? tempCarb.delete(v) : tempCarb.add(v);
      chip.classList.toggle("active");
    });
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
    backdrop.querySelector("#clear-filters").addEventListener("click", () => {
      recipesState.proteinSources.clear();
      recipesState.carbSources.clear();
      backdrop.remove();
      paintRecipesView(allRecipes);
    });
    backdrop.querySelector("#apply-filters").addEventListener("click", () => {
      recipesState.proteinSources = tempProtein;
      recipesState.carbSources = tempCarb;
      backdrop.remove();
      paintRecipesView(allRecipes);
    });
  }

  // ---------------- Recipe detail ----------------
  async function renderRecipeDetailView(id) {
    titleEl.textContent = "Recipe";
    actionsEl.innerHTML = `<button class="icon-btn" id="back-btn" aria-label="Back">←</button>`;
    viewEl.innerHTML = `<div class="skeleton" style="height:300px"></div>`;

    const { ingredients } = await ensureData();
    const recipe = await Store.getRecipeById(id);

    actionsEl.querySelector("#back-btn").addEventListener("click", () => history.back());

    if (!recipe) {
      renderPlaceholder("🤷", "Recipe not found", "It may have been removed.");
      return;
    }

    titleEl.textContent = Util.CATEGORY_LABELS[recipe.category] || "Recipe";

    const ingredientRows = recipe.ingredients
      .map((line) => {
        const { name, amountText } = Util.formatIngredientLine(line, ingredients.byId);
        return `<li><span>${Util.escapeHtml(name)}</span><span class="amt">${Util.escapeHtml(amountText)}</span></li>`;
      })
      .join("");

    const instructionRows = recipe.instructions.map((step) => `<li>${Util.escapeHtml(step)}</li>`).join("");

    viewEl.innerHTML = `
      <div class="detail-header">
        <span class="cat-tag">${Util.CATEGORY_ICONS[recipe.category] || ""} ${Util.CATEGORY_LABELS[recipe.category] || recipe.category}</span>
        <h2>${Util.escapeHtml(recipe.name)}</h2>
        <div class="tags">
          <span class="tag-pill">🥩 ${Util.PROTEIN_SOURCE_LABELS[recipe.proteinSource] || recipe.proteinSource}</span>
          <span class="tag-pill">🌾 ${Util.CARB_SOURCE_LABELS[recipe.carbSource] || recipe.carbSource}</span>
        </div>
      </div>

      <div class="macro-card">
        <div class="stat kcal"><div class="value">${Math.round(recipe.macros.kcal)}</div><div class="label">kcal</div></div>
        <div class="stat protein"><div class="value">${Math.round(recipe.macros.protein)}g</div><div class="label">protein</div></div>
        <div class="stat carbs"><div class="value">${Math.round(recipe.macros.carbs)}g</div><div class="label">carbs</div></div>
        <div class="stat fat"><div class="value">${Math.round(recipe.macros.fat)}g</div><div class="label">fat</div></div>
      </div>

      <p class="servings-note">Makes ${recipe.servings} serving${recipe.servings === 1 ? "" : "s"} · macros shown per serving</p>

      <div class="card">
        <h3>Ingredients</h3>
        <ul class="ingredient-list">${ingredientRows}</ul>
      </div>

      <div class="card">
        <h3>Instructions</h3>
        <ol class="instruction-list">${instructionRows}</ol>
      </div>

      ${recipe.source === "custom" ? `<button class="btn danger block" id="delete-recipe-btn" style="margin-bottom:24px">Delete this recipe</button>` : ""}
    `;

    const deleteBtn = viewEl.querySelector("#delete-recipe-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        if (!confirm(`Delete "${recipe.name}"? This can't be undone.`)) return;
        await Store.deleteCustomRecipe(recipe.id);
        await invalidateRecipes();
        showToast("Recipe deleted");
        navigate("recipes");
      });
    }
  }

  // ---------------- Shared modal helper ----------------
  function openModal(title, bodyHtml, footHtml) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
        <div class="modal-body">${bodyHtml}</div>
        ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ""}
      </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
    backdrop.querySelector("[data-close]").addEventListener("click", () => backdrop.remove());
    return backdrop;
  }

  // ---------------- Macro targets editor ----------------
  async function openTargetsEditor() {
    const targets = await Store.getTargets();
    const body = `
      <div class="field"><label>Daily calories (kcal)</label><input type="number" inputmode="numeric" id="t-kcal" value="${targets.kcal}" /></div>
      <div class="field-row">
        <div class="field"><label>Protein (g)</label><input type="number" inputmode="numeric" id="t-protein" value="${targets.protein}" /></div>
        <div class="field"><label>Carbs (g)</label><input type="number" inputmode="numeric" id="t-carbs" value="${targets.carbs}" /></div>
        <div class="field"><label>Fat (g)</label><input type="number" inputmode="numeric" id="t-fat" value="${targets.fat}" /></div>
      </div>
    `;
    const modal = openModal("Daily Macro Targets", body, `<button class="btn block" id="save-targets">Save targets</button>`);
    modal.querySelector("#save-targets").addEventListener("click", async () => {
      const num = (id, fallback) => Number(modal.querySelector(id).value) || fallback;
      const newTargets = {
        kcal: num("#t-kcal", Store.DEFAULT_TARGETS.kcal),
        protein: num("#t-protein", Store.DEFAULT_TARGETS.protein),
        carbs: num("#t-carbs", Store.DEFAULT_TARGETS.carbs),
        fat: num("#t-fat", Store.DEFAULT_TARGETS.fat),
      };
      await Store.saveTargets(newTargets);
      backdropRemove(modal);
      showToast("Targets updated");
      if (parseHash().name === "planner") await renderPlannerView();
    });
  }

  function backdropRemove(modal) {
    modal.remove();
  }

  // ---------------- Planner ----------------
  function weekIsCurrent(weekStart) {
    return weekStart === Util.toISODate(Util.startOfWeek(new Date()));
  }

  async function renderPlannerView() {
    viewEl.innerHTML = `<div class="skeleton" style="height:60px;margin-bottom:14px"></div><div class="skeleton" style="height:400px"></div>`;
    const [{ recipes }, weekStart] = await Promise.all([ensureData(), ensureActiveWeek()]);
    const [plan, targets] = await Promise.all([Store.getPlan(weekStart), Store.getTargets()]);
    paintPlannerView(recipes, plan, targets);
  }

  function computeDayMacros(dayIndex, plan, recipeMap) {
    const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    Util.MEAL_TYPES.forEach((meal) => {
      const ids = plan.slots[`${dayIndex}:${meal}`] || [];
      ids.forEach((id) => {
        const r = recipeMap[id];
        if (!r) return;
        totals.kcal += r.macros.kcal;
        totals.protein += r.macros.protein;
        totals.carbs += r.macros.carbs;
        totals.fat += r.macros.fat;
      });
    });
    return totals;
  }

  function macroSummaryRowHtml(key, value, target, unit) {
    const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
    const over = value > target;
    const label = key === "kcal" ? "Kcal" : key.charAt(0).toUpperCase() + key.slice(1);
    return `
      <div class="macro-summary-row">
        <span class="m-label ${key}">${label}</span>
        <div class="progress-bar ${key}"><div style="width:${pct}%"></div></div>
        <span class="m-nums ${over ? "over" : ""}">${Math.round(value)}${unit}/${Math.round(target)}${unit}</span>
      </div>
    `;
  }

  function slotCardHtml(meal, dayIndex, plan, recipeMap) {
    const key = `${dayIndex}:${meal}`;
    const ids = plan.slots[key] || [];
    const rows = ids
      .map((id, idx) => {
        const r = recipeMap[id];
        if (!r) return "";
        return `
          <div class="slot-recipe-row">
            <span class="srr-name">${Util.escapeHtml(r.name)}</span>
            <span class="srr-kcal">${Math.round(r.macros.kcal)} kcal</span>
            <button class="srr-remove" data-remove="${key}" data-idx="${idx}" aria-label="Remove">✕</button>
          </div>
        `;
      })
      .join("");
    return `
      <div class="slot-card">
        <div class="slot-head">
          <span class="slot-title">${Util.MEAL_TYPE_ICONS[meal]} ${Util.MEAL_TYPE_LABELS[meal]}</span>
          <button class="slot-add-btn" data-add-slot="${key}">+ Add</button>
        </div>
        ${rows || `<div class="slot-empty-hint">Nothing planned yet</div>`}
      </div>
    `;
  }

  function paintPlannerView(recipes, plan, targets) {
    const recipeMap = recipesById(recipes);
    const weekStart = plannerState.weekStart;
    const dates = Util.getWeekDates(weekStart);
    const todayISO = Util.toISODate(new Date());
    const dayTotals = computeDayMacros(plannerState.activeDay, plan, recipeMap);
    const isCurrent = weekIsCurrent(weekStart);

    viewEl.innerHTML = `
      <div class="week-nav">
        <button class="icon-btn" id="prev-week" aria-label="Previous week">‹</button>
        <div class="week-label">${Util.formatWeekRangeLabel(weekStart)}<span class="week-sub" id="today-link" style="${isCurrent ? "" : "color:var(--color-primary);cursor:pointer;"}">${isCurrent ? "This week" : "Jump to this week"}</span></div>
        <button class="icon-btn" id="next-week" aria-label="Next week">›</button>
      </div>
      <div class="day-chip-row" id="day-chips">
        ${dates
          .map((d, i) => {
            const iso = Util.toISODate(d);
            const isToday = iso === todayISO;
            const active = i === plannerState.activeDay;
            return `<div class="day-chip ${active ? "active" : ""} ${isToday ? "today" : ""}" data-day="${i}">
              <span>${Util.DAY_NAMES[i]}</span>
              <span class="dnum">${d.getDate()}</span>
              ${isToday ? '<span class="dot"></span>' : ""}
            </div>`;
          })
          .join("")}
      </div>
      <div class="macro-summary">
        ${macroSummaryRowHtml("kcal", dayTotals.kcal, targets.kcal, "")}
        ${macroSummaryRowHtml("protein", dayTotals.protein, targets.protein, "g")}
        ${macroSummaryRowHtml("carbs", dayTotals.carbs, targets.carbs, "g")}
        ${macroSummaryRowHtml("fat", dayTotals.fat, targets.fat, "g")}
      </div>
      <div id="slot-list">${Util.MEAL_TYPES.map((meal) => slotCardHtml(meal, plannerState.activeDay, plan, recipeMap)).join("")}</div>
    `;

    viewEl.querySelector("#prev-week").addEventListener("click", () => shiftPlannerWeek(-7, recipes));
    viewEl.querySelector("#next-week").addEventListener("click", () => shiftPlannerWeek(7, recipes));
    viewEl.querySelector("#today-link").addEventListener("click", () => jumpPlannerToToday(recipes));
    viewEl.querySelector("#day-chips").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-day]");
      if (!chip) return;
      plannerState.activeDay = Number(chip.dataset.day);
      paintPlannerView(recipes, plan, targets);
    });
    viewEl.querySelector("#slot-list").addEventListener("click", (e) => {
      const addBtn = e.target.closest("[data-add-slot]");
      if (addBtn) return openRecipePicker(addBtn.dataset.addSlot, recipes, plan);
      const removeBtn = e.target.closest("[data-remove]");
      if (removeBtn) return removeFromSlot(removeBtn.dataset.remove, Number(removeBtn.dataset.idx), plan, recipes, targets);
    });
  }

  async function shiftPlannerWeek(delta, recipes) {
    const newDate = Util.addDays(new Date(plannerState.weekStart + "T00:00:00"), delta);
    plannerState.weekStart = Util.toISODate(Util.startOfWeek(newDate));
    plannerState.activeDay = 0;
    await Store.saveSettings({ lastWeekStart: plannerState.weekStart });
    const [plan, targets] = await Promise.all([Store.getPlan(plannerState.weekStart), Store.getTargets()]);
    paintPlannerView(recipes, plan, targets);
  }

  async function jumpPlannerToToday(recipes) {
    plannerState.weekStart = Util.toISODate(Util.startOfWeek(new Date()));
    const dates = Util.getWeekDates(plannerState.weekStart);
    const todayISO = Util.toISODate(new Date());
    plannerState.activeDay = Math.max(0, dates.findIndex((d) => Util.toISODate(d) === todayISO));
    await Store.saveSettings({ lastWeekStart: plannerState.weekStart });
    const [plan, targets] = await Promise.all([Store.getPlan(plannerState.weekStart), Store.getTargets()]);
    paintPlannerView(recipes, plan, targets);
  }

  async function removeFromSlot(key, idx, plan, recipes, targets) {
    plan.slots[key].splice(idx, 1);
    if (!plan.slots[key].length) delete plan.slots[key];
    await Store.savePlan(plannerState.weekStart, plan);
    paintPlannerView(recipes, plan, targets);
  }

  function openRecipePicker(slotKey, recipes, plan) {
    const meal = slotKey.split(":")[1];
    const localState = { query: "", category: meal };

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-head"><h2>Add to ${Util.MEAL_TYPE_LABELS[meal]}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
        <div class="modal-body"></div>
        <div class="modal-foot"><button class="btn block" data-done>Done</button></div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const bodyEl = backdrop.querySelector(".modal-body");

    async function closeAndRepaint() {
      backdrop.remove();
      const targets = await Store.getTargets();
      paintPlannerView(recipes, plan, targets);
    }

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeAndRepaint();
    });
    backdrop.querySelector("[data-close]").addEventListener("click", closeAndRepaint);
    backdrop.querySelector("[data-done]").addEventListener("click", closeAndRepaint);

    function countsForSlot() {
      const ids = plan.slots[slotKey] || [];
      const c = {};
      ids.forEach((id) => (c[id] = (c[id] || 0) + 1));
      return c;
    }

    function renderBody() {
      const q = localState.query.trim().toLowerCase();
      const filtered = recipes.filter((r) => (!q || r.name.toLowerCase().includes(q)) && (!localState.category || r.category === localState.category));
      const c = countsForSlot();
      bodyEl.innerHTML = `
        <div class="search-row" style="margin-bottom:10px">
          <input type="text" class="search-input" id="picker-search" placeholder="Search recipes…" value="${Util.escapeHtml(localState.query)}" />
        </div>
        <div class="filter-chip-row" id="picker-cats">
          <div class="chip ${!localState.category ? "active" : ""}" data-cat="">All</div>
          ${Util.CATEGORIES.map((cat) => `<div class="chip ${localState.category === cat ? "active" : ""}" data-cat="${cat}">${Util.CATEGORY_ICONS[cat]} ${Util.CATEGORY_LABELS[cat]}</div>`).join("")}
        </div>
        <div class="recipe-picker-list">
          ${
            filtered.length
              ? filtered
                  .map(
                    (r) => `
            <div class="recipe-picker-row" data-id="${r.id}">
              <div class="rp-info">
                <div class="rp-name">${Util.escapeHtml(r.name)}</div>
                <div class="rp-macros">${Math.round(r.macros.kcal)} kcal · ${Math.round(r.macros.protein)}p/${Math.round(r.macros.carbs)}c/${Math.round(r.macros.fat)}f</div>
              </div>
              <button class="rp-add" data-add="${r.id}">${c[r.id] ? c[r.id] + "×" : "+"}</button>
            </div>
          `
                  )
                  .join("")
              : `<div class="empty-state">No recipes match.</div>`
          }
        </div>
      `;
      const input = bodyEl.querySelector("#picker-search");
      input.addEventListener(
        "input",
        Util.debounce((e) => {
          localState.query = e.target.value;
          const caret = e.target.selectionStart;
          renderBody();
          const el = bodyEl.querySelector("#picker-search");
          el.focus();
          el.setSelectionRange(caret, caret);
        }, 150)
      );
    }

    bodyEl.addEventListener("click", async (e) => {
      const chip = e.target.closest("[data-cat]");
      if (chip) {
        localState.category = chip.dataset.cat || null;
        renderBody();
        return;
      }
      const addBtn = e.target.closest("[data-add]");
      if (addBtn) {
        const recipeId = addBtn.dataset.add;
        plan.slots[slotKey] = plan.slots[slotKey] || [];
        plan.slots[slotKey].push(recipeId);
        await Store.savePlan(plannerState.weekStart, plan);
        renderBody();
      }
    });

    renderBody();
  }

  // ---------------- Shopping list ----------------
  async function renderShoppingView() {
    viewEl.innerHTML = `<div class="skeleton" style="height:60px;margin-bottom:14px"></div><div class="skeleton" style="height:400px"></div>`;
    const [{ recipes, ingredients }, weekStart] = await Promise.all([ensureData(), ensureActiveWeek()]);
    const [plan, settings, checked] = await Promise.all([Store.getPlan(weekStart), Store.getSettings(), Store.getShoppingChecked(weekStart)]);
    paintShoppingView(recipes, ingredients, plan, settings, checked);
  }

  function shoppingItemHtml(item, checked) {
    const isChecked = !!checked[item.key];
    return `
      <div class="shopping-item ${isChecked ? "checked" : ""}" data-item-key="${item.key}">
        <span class="chk">${isChecked ? "✓" : ""}</span>
        <div class="item-info">
          <div class="item-name">${Util.escapeHtml(item.name)}</div>
          <div class="item-buy">${Util.escapeHtml(item.buyLabel)}</div>
        </div>
        <span class="item-price">${item.packages ? "$" + item.cost.toFixed(2) : "—"}</span>
      </div>
    `;
  }

  function paintShoppingView(recipes, ingredients, plan, settings, checked) {
    const recipeMap = recipesById(recipes);
    const weekStart = plannerState.weekStart;
    const list = Shopping.buildList(plan.slots, recipeMap, ingredients.byId, settings.familyMultiplier || 1);
    const isCurrent = weekIsCurrent(weekStart);

    viewEl.innerHTML = `
      <div class="week-nav">
        <button class="icon-btn" id="prev-week" aria-label="Previous week">‹</button>
        <div class="week-label">${Util.formatWeekRangeLabel(weekStart)}<span class="week-sub">${isCurrent ? "This week" : ""}</span></div>
        <button class="icon-btn" id="next-week" aria-label="Next week">›</button>
      </div>
      <div class="card" style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:13px;font-weight:600;">Household size</div>
          <div style="font-size:11.5px;color:var(--color-text-dim)">Scales quantities for extra people</div>
        </div>
        <div class="stepper">
          <button data-step="-1" aria-label="Decrease">−</button>
          <span class="stepper-val">${settings.familyMultiplier}×</span>
          <button data-step="1" aria-label="Increase">+</button>
        </div>
      </div>
      ${
        list.isEmpty
          ? `<div class="empty-plan-hint"><div style="font-size:36px">🛒</div><p>Nothing planned for this week yet.<br/>Add recipes in the Planner tab and your shopping list builds itself.</p></div>`
          : `
        <div class="shopping-summary-bar">
          <div><div class="total-cost">$${list.totalCost.toFixed(2)}</div><div class="total-label">estimated total</div></div>
          <button class="btn secondary" id="save-list-btn">Save list</button>
        </div>
        <div id="shopping-sections">
          ${list.sections
            .map(
              (sec) => `
            <div class="shopping-section-title">${Util.GROCERY_SECTION_ICONS[sec.section]} ${Util.GROCERY_SECTION_LABELS[sec.section]}</div>
            ${sec.items.map((item) => shoppingItemHtml(item, checked)).join("")}
          `
            )
            .join("")}
        </div>
      `
      }
    `;

    viewEl.querySelector("#prev-week").addEventListener("click", () => shiftShoppingWeek(-7, recipes, ingredients));
    viewEl.querySelector("#next-week").addEventListener("click", () => shiftShoppingWeek(7, recipes, ingredients));

    viewEl.querySelector(".stepper").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-step]");
      if (!btn) return;
      const delta = Number(btn.dataset.step);
      const newVal = Math.min(12, Math.max(1, (settings.familyMultiplier || 1) + delta));
      const newSettings = await Store.saveSettings({ familyMultiplier: newVal });
      paintShoppingView(recipes, ingredients, plan, newSettings, checked);
    });

    const sectionsEl = viewEl.querySelector("#shopping-sections");
    if (sectionsEl) {
      sectionsEl.addEventListener("click", async (e) => {
        const row = e.target.closest("[data-item-key]");
        if (!row) return;
        const key = row.dataset.itemKey;
        checked[key] = !checked[key];
        row.classList.toggle("checked", !!checked[key]);
        row.querySelector(".chk").textContent = checked[key] ? "✓" : "";
        await Store.saveShoppingChecked(weekStart, checked);
      });
    }

    const saveBtn = viewEl.querySelector("#save-list-btn");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        await Store.saveShoppingList({
          id: Util.uid("list"),
          weekStart,
          weekLabel: Util.formatWeekRangeLabel(weekStart),
          savedAt: Date.now(),
          sections: list.sections,
          totalCost: list.totalCost,
        });
        showToast("Shopping list saved");
      });
    }
  }

  async function shiftShoppingWeek(delta, recipes, ingredients) {
    const newDate = Util.addDays(new Date(plannerState.weekStart + "T00:00:00"), delta);
    plannerState.weekStart = Util.toISODate(Util.startOfWeek(newDate));
    await Store.saveSettings({ lastWeekStart: plannerState.weekStart });
    const [plan, settings, checked] = await Promise.all([Store.getPlan(plannerState.weekStart), Store.getSettings(), Store.getShoppingChecked(plannerState.weekStart)]);
    paintShoppingView(recipes, ingredients, plan, settings, checked);
  }

  // ---------------- Macro gap finder ----------------
  async function renderGapFinderView() {
    viewEl.innerHTML = `<div class="skeleton" style="height:220px;margin-bottom:14px"></div><div class="skeleton" style="height:200px"></div>`;
    const { recipes } = await ensureData();
    paintGapFinderView(recipes);
  }

  function syncGapInputsFromDOM() {
    const p = viewEl.querySelector("#gf-protein");
    if (!p) return;
    gapFinderState.protein = p.value;
    gapFinderState.carbs = viewEl.querySelector("#gf-carbs").value;
    gapFinderState.fat = viewEl.querySelector("#gf-fat").value;
  }

  function doGapSearch(recipes) {
    syncGapInputsFromDOM();
    const target = {
      protein: Number(gapFinderState.protein) || 0,
      carbs: Number(gapFinderState.carbs) || 0,
      fat: Number(gapFinderState.fat) || 0,
    };
    if (!target.protein && !target.carbs && !target.fat) {
      gapFinderState.target = target;
      gapFinderState.results = { noInput: true };
      paintGapFinderView(recipes);
      return;
    }
    const candidates = recipes.filter((r) => {
      if (gapFinderState.category && r.category !== gapFinderState.category) return false;
      if (gapFinderState.proteinSources.size && !gapFinderState.proteinSources.has(r.proteinSource)) return false;
      if (gapFinderState.carbSources.size && !gapFinderState.carbSources.has(r.carbSource)) return false;
      return true;
    });
    gapFinderState.target = target;
    gapFinderState.results = GapFinder.findMatches(candidates, target);
    paintGapFinderView(recipes);
  }

  function deltaSpanHtml(label, actual, target) {
    const diff = actual - target;
    const tolerance = Math.max(target * 0.12, 3);
    const cls = Math.abs(diff) <= tolerance ? "good" : diff > 0 ? "over" : "under";
    const sign = diff > 0 ? "+" : "";
    return `<span class="delta ${cls}">${label} ${sign}${Math.round(diff)}g</span>`;
  }

  function gapResultCardHtml(result, target) {
    const m = result.macros;
    const isSingle = result.items.length === 1;
    const itemsHtml = result.items.map((it) => `<span data-recipe-id="${it.id}">${Util.escapeHtml(it.name)}</span>`).join(' <span class="plus">+</span> ');
    return `
      <div class="gap-result-card" ${isSingle ? `data-recipe-id="${result.items[0].id}"` : ""}>
        <div class="gap-result-items">${itemsHtml}</div>
        <div class="macro-row" style="margin-top:8px">
          <span class="macro-pill kcal">${Math.round(m.kcal)} kcal</span>
          <span class="macro-pill protein">${Math.round(m.protein)}p</span>
          <span class="macro-pill carbs">${Math.round(m.carbs)}c</span>
          <span class="macro-pill fat">${Math.round(m.fat)}f</span>
        </div>
        <div class="gap-delta-row">
          ${deltaSpanHtml("Protein", m.protein, target.protein)}
          ${deltaSpanHtml("Carbs", m.carbs, target.carbs)}
          ${deltaSpanHtml("Fat", m.fat, target.fat)}
        </div>
      </div>
    `;
  }

  function gapResultsHtml() {
    const r = gapFinderState.results;
    if (!r) return `<div class="empty-state">Enter what you have left today and tap <strong>Find matches</strong>.</div>`;
    if (r.noInput) return `<div class="empty-state">Enter at least one macro amount to search.</div>`;
    if (!r.singles.length && !r.combos.length) return `<div class="empty-state">No recipes match your filters.<br/>Try clearing a filter.</div>`;
    return `
      ${r.singles.length ? `<div class="section-title">Closest single recipes</div>${r.singles.map((res) => gapResultCardHtml(res, gapFinderState.target)).join("")}` : ""}
      ${r.combos.length ? `<div class="section-title">Closest combos (2-3 items)</div>${r.combos.map((res) => gapResultCardHtml(res, gapFinderState.target)).join("")}` : ""}
    `;
  }

  function paintGapFinderView(recipes) {
    const state = gapFinderState;
    const activeFilterCount = state.proteinSources.size + state.carbSources.size;

    viewEl.innerHTML = `
      <div class="card">
        <h3>What do you have left today?</h3>
        <div class="field-row">
          <div class="field"><label>Protein (g)</label><input type="number" inputmode="numeric" id="gf-protein" placeholder="0" value="${Util.escapeHtml(state.protein)}" /></div>
          <div class="field"><label>Carbs (g)</label><input type="number" inputmode="numeric" id="gf-carbs" placeholder="0" value="${Util.escapeHtml(state.carbs)}" /></div>
          <div class="field"><label>Fat (g)</label><input type="number" inputmode="numeric" id="gf-fat" placeholder="0" value="${Util.escapeHtml(state.fat)}" /></div>
        </div>
        <button class="btn block" id="find-btn">🎯 Find matches</button>
      </div>
      <div class="search-row">
        <div class="section-title" style="margin:0;flex:1">Filter results</div>
        <button class="icon-btn" id="gf-filters-btn" aria-label="Filters" style="position:relative">🎚️${activeFilterCount ? `<span style="position:absolute;transform:translate(10px,-10px);background:var(--color-danger);color:#fff;border-radius:999px;font-size:9px;padding:1px 5px;">${activeFilterCount}</span>` : ""}</button>
      </div>
      <div class="filter-chip-row" id="gf-cat-chips">
        <div class="chip ${!state.category ? "active" : ""}" data-cat="">All meals</div>
        ${Util.CATEGORIES.map((c) => `<div class="chip ${state.category === c ? "active" : ""}" data-cat="${c}">${Util.CATEGORY_ICONS[c]} ${Util.CATEGORY_LABELS[c]}</div>`).join("")}
      </div>
      <div id="gf-results">${gapResultsHtml()}</div>
    `;

    viewEl.querySelector("#find-btn").addEventListener("click", () => doGapSearch(recipes));
    viewEl.querySelector("#gf-filters-btn").addEventListener("click", () => openGapFilterSheet(recipes));
    viewEl.querySelector("#gf-cat-chips").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-cat]");
      if (!chip) return;
      syncGapInputsFromDOM();
      gapFinderState.category = chip.dataset.cat || null;
      if (gapFinderState.results && !gapFinderState.results.noInput) doGapSearch(recipes);
      else paintGapFinderView(recipes);
    });
    viewEl.querySelector("#gf-results").addEventListener("click", (e) => {
      const link = e.target.closest("[data-recipe-id]");
      if (!link) return;
      navigate(`recipe/${link.dataset.recipeId}`);
    });
  }

  function openGapFilterSheet(recipes) {
    const backdrop = document.createElement("div");
    backdrop.className = "filter-sheet-backdrop";
    const tempProtein = new Set(gapFinderState.proteinSources);
    const tempCarb = new Set(gapFinderState.carbSources);

    function optionsHtml(list, labels, selectedSet) {
      return `<div class="filter-options">${list.map((v) => `<div class="chip ${selectedSet.has(v) ? "active" : ""}" data-v="${v}">${labels[v]}</div>`).join("")}</div>`;
    }

    backdrop.innerHTML = `
      <div class="filter-sheet">
        <h3>Protein source</h3>
        <div id="protein-opts">${optionsHtml(Util.PROTEIN_SOURCES, Util.PROTEIN_SOURCE_LABELS, tempProtein)}</div>
        <h3>Carb source</h3>
        <div id="carb-opts">${optionsHtml(Util.CARB_SOURCES, Util.CARB_SOURCE_LABELS, tempCarb)}</div>
        <div style="display:flex;gap:10px;margin-top:20px;">
          <button class="btn secondary" id="clear-filters" style="flex:1">Clear</button>
          <button class="btn" id="apply-filters" style="flex:2">Apply</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    backdrop.querySelector("#protein-opts").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-v]");
      if (!chip) return;
      const v = chip.dataset.v;
      tempProtein.has(v) ? tempProtein.delete(v) : tempProtein.add(v);
      chip.classList.toggle("active");
    });
    backdrop.querySelector("#carb-opts").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-v]");
      if (!chip) return;
      const v = chip.dataset.v;
      tempCarb.has(v) ? tempCarb.delete(v) : tempCarb.add(v);
      chip.classList.toggle("active");
    });
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
    backdrop.querySelector("#clear-filters").addEventListener("click", () => {
      syncGapInputsFromDOM();
      gapFinderState.proteinSources.clear();
      gapFinderState.carbSources.clear();
      backdrop.remove();
      if (gapFinderState.results && !gapFinderState.results.noInput) doGapSearch(recipes);
      else paintGapFinderView(recipes);
    });
    backdrop.querySelector("#apply-filters").addEventListener("click", () => {
      syncGapInputsFromDOM();
      gapFinderState.proteinSources = tempProtein;
      gapFinderState.carbSources = tempCarb;
      backdrop.remove();
      if (gapFinderState.results && !gapFinderState.results.noInput) doGapSearch(recipes);
      else paintGapFinderView(recipes);
    });
  }

  // ---------------- Add custom recipe ----------------
  function optionsForSelect(list, labels, selected, placeholder) {
    const opts = list.map((v) => `<option value="${v}" ${selected === v ? "selected" : ""}>${labels[v]}</option>`).join("");
    return placeholder ? `<option value="" ${!selected ? "selected" : ""}>${placeholder}</option>${opts}` : opts;
  }

  function resetAddRecipeState() {
    addRecipeState.name = "";
    addRecipeState.category = "";
    addRecipeState.proteinSource = "";
    addRecipeState.carbSource = "";
    addRecipeState.servings = "1";
    addRecipeState.ingredients = [];
    addRecipeState.instructions = [""];
    addRecipeState.macros = { kcal: "", protein: "", carbs: "", fat: "" };
  }

  async function renderAddRecipeView() {
    resetAddRecipeState();
    actionsEl.innerHTML = `<button class="icon-btn" id="back-btn" aria-label="Back">←</button>`;
    actionsEl.querySelector("#back-btn").addEventListener("click", () => history.back());
    viewEl.innerHTML = `<div class="skeleton" style="height:500px"></div>`;
    await ensureData();
    paintAddRecipeView();
  }

  function syncAddRecipeFieldsFromDOM() {
    const nameEl = viewEl.querySelector("#ar-name");
    if (!nameEl) return;
    addRecipeState.name = nameEl.value;
    addRecipeState.category = viewEl.querySelector("#ar-category").value;
    addRecipeState.servings = viewEl.querySelector("#ar-servings").value;
    addRecipeState.proteinSource = viewEl.querySelector("#ar-protein-source").value;
    addRecipeState.carbSource = viewEl.querySelector("#ar-carb-source").value;
    addRecipeState.instructions = [...viewEl.querySelectorAll(".ar-step-input")].map((el) => el.value);
    addRecipeState.macros = {
      kcal: viewEl.querySelector("#ar-kcal").value,
      protein: viewEl.querySelector("#ar-protein").value,
      carbs: viewEl.querySelector("#ar-carbs").value,
      fat: viewEl.querySelector("#ar-fat").value,
    };
  }

  function arIngredientRowHtml(line, idx) {
    const { name, amountText } = Util.formatIngredientLine(line, ingredientsCache.byId);
    return `<li><span>${Util.escapeHtml(name)}</span><span class="amt">${Util.escapeHtml(amountText)} <button data-remove-ing="${idx}" style="margin-left:8px;border:none;background:none;color:var(--color-text-dim);cursor:pointer;font-size:14px;">✕</button></span></li>`;
  }

  function arInstructionRowHtml(step, idx) {
    return `
      <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:10px;">
        <span style="flex:none;width:24px;height:24px;border-radius:50%;background:var(--color-primary-dim);color:var(--color-primary);font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;margin-top:10px;">${idx + 1}</span>
        <textarea class="ar-step-input" data-idx="${idx}" style="flex:1;min-height:44px;padding:10px 12px;border-radius:8px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text);font-size:14.5px;">${Util.escapeHtml(step)}</textarea>
        <button data-remove-step="${idx}" class="srr-remove" style="margin-top:10px" aria-label="Remove step">✕</button>
      </div>
    `;
  }

  function paintAddRecipeView() {
    const s = addRecipeState;
    viewEl.innerHTML = `
      <div class="card">
        <div class="field"><label>Recipe name</label><input type="text" id="ar-name" value="${Util.escapeHtml(s.name)}" placeholder="e.g. Grilled Chicken Power Bowl" /></div>
        <div class="field-row">
          <div class="field"><label>Category</label><select id="ar-category">${optionsForSelect(Util.CATEGORIES, Util.CATEGORY_LABELS, s.category, "Choose…")}</select></div>
          <div class="field"><label>Servings</label><input type="number" id="ar-servings" value="${Util.escapeHtml(s.servings)}" min="1" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Protein source</label><select id="ar-protein-source">${optionsForSelect(Util.PROTEIN_SOURCES, Util.PROTEIN_SOURCE_LABELS, s.proteinSource, "Choose…")}</select></div>
          <div class="field"><label>Carb source</label><select id="ar-carb-source">${optionsForSelect(Util.CARB_SOURCES, Util.CARB_SOURCE_LABELS, s.carbSource, "Choose…")}</select></div>
        </div>
      </div>

      <div class="card">
        <h3>Ingredients</h3>
        <ul class="ingredient-list" id="ar-ingredient-list">${s.ingredients.length ? s.ingredients.map(arIngredientRowHtml).join("") : `<li style="border:none;padding:0;color:var(--color-text-dim);font-size:13.5px;">No ingredients yet</li>`}</ul>
        <button class="slot-add-btn" id="ar-add-ingredient" style="margin-top:12px;width:100%;">+ Add ingredient</button>
      </div>

      <div class="card">
        <h3>Instructions</h3>
        <div id="ar-instruction-list">${s.instructions.map(arInstructionRowHtml).join("")}</div>
        <button class="slot-add-btn" id="ar-add-step" style="width:100%;">+ Add step</button>
      </div>

      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <h3 style="margin:0">Macros per serving</h3>
          <button class="btn secondary" id="ar-autocalc" style="padding:0 12px;min-height:34px;font-size:12.5px">Auto-calc</button>
        </div>
        <div class="field-row">
          <div class="field"><label>Kcal</label><input type="number" id="ar-kcal" value="${Util.escapeHtml(String(s.macros.kcal))}" /></div>
          <div class="field"><label>Protein (g)</label><input type="number" id="ar-protein" value="${Util.escapeHtml(String(s.macros.protein))}" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Carbs (g)</label><input type="number" id="ar-carbs" value="${Util.escapeHtml(String(s.macros.carbs))}" /></div>
          <div class="field"><label>Fat (g)</label><input type="number" id="ar-fat" value="${Util.escapeHtml(String(s.macros.fat))}" /></div>
        </div>
      </div>

      <button class="btn block" id="ar-save" style="margin-bottom:28px">Save recipe</button>
    `;

    viewEl.querySelector("#ar-add-ingredient").addEventListener("click", () => {
      syncAddRecipeFieldsFromDOM();
      openIngredientPicker();
    });
    viewEl.querySelector("#ar-ingredient-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-ing]");
      if (!btn) return;
      syncAddRecipeFieldsFromDOM();
      addRecipeState.ingredients.splice(Number(btn.dataset.removeIng), 1);
      paintAddRecipeView();
    });
    viewEl.querySelector("#ar-add-step").addEventListener("click", () => {
      syncAddRecipeFieldsFromDOM();
      addRecipeState.instructions.push("");
      paintAddRecipeView();
    });
    viewEl.querySelector("#ar-instruction-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-step]");
      if (!btn) return;
      syncAddRecipeFieldsFromDOM();
      if (addRecipeState.instructions.length <= 1) return;
      addRecipeState.instructions.splice(Number(btn.dataset.removeStep), 1);
      paintAddRecipeView();
    });
    viewEl.querySelector("#ar-autocalc").addEventListener("click", () => autoCalcMacros());
    viewEl.querySelector("#ar-save").addEventListener("click", () => saveNewRecipe());
  }

  function autoCalcMacros() {
    syncAddRecipeFieldsFromDOM();
    const servings = Number(addRecipeState.servings) || 1;
    let kcal = 0,
      protein = 0,
      carbs = 0,
      fat = 0;
    addRecipeState.ingredients.forEach((line) => {
      if (line.freeform) return;
      const ing = ingredientsCache.byId[line.id];
      if (!ing) return;
      const factor = line.amount / ing.macroBasis;
      kcal += factor * ing.macros.kcal;
      protein += factor * ing.macros.protein;
      carbs += factor * ing.macros.carbs;
      fat += factor * ing.macros.fat;
    });
    if (!addRecipeState.ingredients.some((l) => !l.freeform)) {
      showToast("Add at least one non-custom ingredient to auto-calculate");
      return;
    }
    addRecipeState.macros = {
      kcal: Util.round(kcal / servings),
      protein: Util.round(protein / servings, 1),
      carbs: Util.round(carbs / servings, 1),
      fat: Util.round(fat / servings, 1),
    };
    paintAddRecipeView();
  }

  async function saveNewRecipe() {
    syncAddRecipeFieldsFromDOM();
    const name = addRecipeState.name.trim();
    if (!name) return showToast("Please enter a recipe name");
    if (!addRecipeState.category) return showToast("Please choose a category");
    if (!addRecipeState.ingredients.length) return showToast("Add at least one ingredient");
    const instructions = addRecipeState.instructions.map((s) => s.trim()).filter(Boolean);
    if (!instructions.length) return showToast("Add at least one instruction step");

    const baseId = Util.slugify(name) || "custom-recipe";
    const id = `${baseId}-${Util.uid("r").slice(-6)}`;
    const recipe = {
      id,
      name,
      category: addRecipeState.category,
      proteinSource: addRecipeState.proteinSource || "none",
      carbSource: addRecipeState.carbSource || "none",
      servings: Number(addRecipeState.servings) || 1,
      ingredients: addRecipeState.ingredients,
      instructions,
      macros: {
        kcal: Number(addRecipeState.macros.kcal) || 0,
        protein: Number(addRecipeState.macros.protein) || 0,
        carbs: Number(addRecipeState.macros.carbs) || 0,
        fat: Number(addRecipeState.macros.fat) || 0,
      },
    };
    await Store.saveCustomRecipe(recipe);
    const shareResult = await Store.postSharedRecipe(recipe);
    await invalidateRecipes();
    showToast(shareResultToast(shareResult));
    navigate(`recipe/${id}`);
  }

  function shareResultToast(shareResult) {
    if (!shareResult.configured) return "Recipe saved!";
    if (shareResult.ok) return "Recipe saved and shared with everyone!";
    return "Saved to your recipes — couldn't sync to the shared list right now.";
  }

  // ---------------- Ingredient picker (for custom recipes) ----------------
  function openIngredientPicker() {
    let mode = "existing";
    let selectedId = null;
    let amount = "";
    let query = "";
    const newIng = { name: "", section: "protein", unit: "g", kcal: "", protein: "", carbs: "", fat: "", packageSize: "", packageLabel: "", price: "" };

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-head"><h2>Add Ingredient</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
        <div class="modal-body"></div>
        <div class="modal-foot"><button class="btn block" id="ing-confirm" disabled>Add to recipe</button></div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const bodyEl = backdrop.querySelector(".modal-body");
    const footBtn = backdrop.querySelector("#ing-confirm");

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
    backdrop.querySelector("[data-close]").addEventListener("click", () => backdrop.remove());

    function modeChipsHtml() {
      return `
        <div class="filter-chip-row" style="margin-bottom:12px">
          <div class="chip ${mode === "existing" ? "active" : ""}" data-mode="existing">Existing ingredient</div>
          <div class="chip ${mode === "new" ? "active" : ""}" data-mode="new">+ New ingredient</div>
        </div>
      `;
    }

    function renderBody() {
      if (mode === "existing") {
        footBtn.disabled = !selectedId || !amount;
        const q = query.trim().toLowerCase();
        const filtered = ingredientsCache.list.filter((i) => !q || i.name.toLowerCase().includes(q));
        bodyEl.innerHTML = `
          ${modeChipsHtml()}
          <div class="search-row" style="margin-bottom:10px"><input type="text" class="search-input" id="ing-search" placeholder="Search ingredients…" value="${Util.escapeHtml(query)}" /></div>
          <div class="recipe-picker-list" style="max-height:260px;overflow-y:auto;">
            ${
              filtered.length
                ? filtered
                    .slice(0, 60)
                    .map(
                      (i) => `
              <div class="recipe-picker-row" data-ing-id="${i.id}" style="${selectedId === i.id ? "outline:2px solid var(--color-primary)" : ""}">
                <div class="rp-info"><div class="rp-name">${Util.escapeHtml(i.name)}</div><div class="rp-macros">${Util.GROCERY_SECTION_LABELS[i.section] || i.section} · per ${i.macroBasis}${i.unit === "each" ? " each" : "g"}: ${Math.round(i.macros.kcal)} kcal</div></div>
                ${selectedId === i.id ? '<span style="color:var(--color-primary);font-weight:700">✓</span>' : ""}
              </div>
            `
                    )
                    .join("")
                : `<div class="empty-state">No ingredients match.</div>`
            }
          </div>
          ${selectedId ? `<div class="field" style="margin-top:14px"><label>Amount (${ingredientsCache.byId[selectedId].unit === "each" ? "count" : "grams"})</label><input type="number" id="ing-amount" value="${Util.escapeHtml(amount)}" placeholder="e.g. 150" /></div>` : ""}
        `;
        const searchInput = bodyEl.querySelector("#ing-search");
        searchInput.addEventListener(
          "input",
          Util.debounce((e) => {
            query = e.target.value;
            const caret = e.target.selectionStart;
            renderBody();
            const el = bodyEl.querySelector("#ing-search");
            el.focus();
            el.setSelectionRange(caret, caret);
          }, 150)
        );
        const amtInput = bodyEl.querySelector("#ing-amount");
        if (amtInput) {
          amtInput.focus();
          amtInput.addEventListener("input", (e) => {
            amount = e.target.value;
            footBtn.disabled = !amount;
          });
        }
      } else {
        footBtn.disabled = !(newIng.name.trim() && amount);
        bodyEl.innerHTML = `
          ${modeChipsHtml()}
          <div class="field"><label>Ingredient name</label><input type="text" id="ni-name" value="${Util.escapeHtml(newIng.name)}" placeholder='e.g. "Reduced-fat feta cheese"' /></div>
          <div class="field-row">
            <div class="field"><label>Grocery section</label><select id="ni-section">${["protein", "grains", "produce", "dairy", "pantry"].map((sec) => `<option value="${sec}" ${newIng.section === sec ? "selected" : ""}>${Util.GROCERY_SECTION_LABELS[sec]}</option>`).join("")}</select></div>
            <div class="field"><label>Measured by</label><select id="ni-unit"><option value="g" ${newIng.unit === "g" ? "selected" : ""}>Weight (g)</option><option value="each" ${newIng.unit === "each" ? "selected" : ""}>Count (each)</option></select></div>
          </div>
          <div class="field"><label>Amount used in this recipe (${newIng.unit === "each" ? "count" : "grams"})</label><input type="number" id="ni-amount" value="${Util.escapeHtml(amount)}" placeholder="e.g. 150" /></div>
          <div class="section-title" style="margin:14px 0 8px">Macros per ${newIng.unit === "each" ? "1 item" : "100g"} <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></div>
          <div class="field-row">
            <div class="field"><label>Kcal</label><input type="number" id="ni-kcal" value="${Util.escapeHtml(newIng.kcal)}" /></div>
            <div class="field"><label>Protein (g)</label><input type="number" id="ni-protein" value="${Util.escapeHtml(newIng.protein)}" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Carbs (g)</label><input type="number" id="ni-carbs" value="${Util.escapeHtml(newIng.carbs)}" /></div>
            <div class="field"><label>Fat (g)</label><input type="number" id="ni-fat" value="${Util.escapeHtml(newIng.fat)}" /></div>
          </div>
          <div class="section-title" style="margin:14px 0 8px">Grocery package <span style="font-weight:400;text-transform:none;letter-spacing:0;">(for shopping list, optional)</span></div>
          <div class="field-row">
            <div class="field"><label>Package size</label><input type="number" id="ni-pkg-size" value="${Util.escapeHtml(newIng.packageSize)}" placeholder="e.g. 400" /></div>
            <div class="field"><label>Price ($)</label><input type="number" id="ni-price" value="${Util.escapeHtml(newIng.price)}" placeholder="e.g. 4.99" /></div>
          </div>
          <div class="field"><label>Package label</label><input type="text" id="ni-pkg-label" value="${Util.escapeHtml(newIng.packageLabel)}" placeholder='e.g. "14 oz block"' /></div>
        `;
        const ids = ["ni-name", "ni-amount", "ni-kcal", "ni-protein", "ni-carbs", "ni-fat", "ni-pkg-size", "ni-price", "ni-pkg-label"];
        ids.forEach((id) => {
          const el = bodyEl.querySelector("#" + id);
          if (!el) return;
          el.addEventListener("input", () => {
            const map = { "ni-name": "name", "ni-amount": null, "ni-kcal": "kcal", "ni-protein": "protein", "ni-carbs": "carbs", "ni-fat": "fat", "ni-pkg-size": "packageSize", "ni-price": "price", "ni-pkg-label": "packageLabel" };
            if (id === "ni-amount") amount = el.value;
            else newIng[map[id]] = el.value;
            footBtn.disabled = !(newIng.name.trim() && amount);
          });
        });
        bodyEl.querySelector("#ni-section").addEventListener("change", (e) => (newIng.section = e.target.value));
        bodyEl.querySelector("#ni-unit").addEventListener("change", (e) => {
          newIng.unit = e.target.value;
          renderBody();
        });
      }
    }

    bodyEl.addEventListener("click", (e) => {
      const modeChip = e.target.closest("[data-mode]");
      if (modeChip) {
        mode = modeChip.dataset.mode;
        renderBody();
        return;
      }
      const row = e.target.closest("[data-ing-id]");
      if (row) {
        selectedId = row.dataset.ingId;
        amount = "";
        renderBody();
      }
    });

    footBtn.addEventListener("click", async () => {
      if (mode === "existing") {
        if (!selectedId || !amount) return;
        addRecipeState.ingredients.push({ id: selectedId, amount: Number(amount) });
      } else {
        if (!newIng.name.trim() || !amount) return;
        const id = `${Util.slugify(newIng.name)}-${Util.uid("ci").slice(-6)}`;
        const macroBasis = newIng.unit === "each" ? 1 : 100;
        const ingredient = {
          id,
          name: newIng.name.trim(),
          section: newIng.section,
          unit: newIng.unit,
          macroBasis,
          macros: {
            kcal: Number(newIng.kcal) || 0,
            protein: Number(newIng.protein) || 0,
            carbs: Number(newIng.carbs) || 0,
            fat: Number(newIng.fat) || 0,
          },
          package: {
            size: Number(newIng.packageSize) || macroBasis,
            unit: newIng.unit,
            label: newIng.packageLabel.trim() || (newIng.unit === "each" ? "1 item" : "100 g"),
            price: Number(newIng.price) || 0,
          },
        };
        await Store.saveCustomIngredient(ingredient);
        ingredientsCache = await Store.getIngredients();
        addRecipeState.ingredients.push({ id, amount: Number(amount) });
      }
      backdrop.remove();
      paintAddRecipeView();
    });

    renderBody();
  }

  // ---------------- Healthify my recipe ----------------
  async function renderHealthifyView() {
    actionsEl.innerHTML = `<button class="icon-btn" id="back-btn" aria-label="Back">←</button>`;
    actionsEl.querySelector("#back-btn").addEventListener("click", () => history.back());
    viewEl.innerHTML = `<div class="skeleton" style="height:300px"></div>`;
    if (healthifyApiKey === undefined) healthifyApiKey = await Store.getApiKey();
    paintHealthifyView();
  }

  function healthifyKeySetupHtml() {
    return `
      <div class="card">
        <h3>Connect your Claude API key</h3>
        <p style="font-size:13px;color:var(--color-text-dim);line-height:1.5;margin:8px 0 16px;">
          Healthify calls the Claude API directly from your browser — this app has no backend server.
          Your key is stored only on this device (localStorage) and is sent only to Anthropic's API, never anywhere else.
        </p>
        <div class="field"><label>Anthropic API key</label><input type="password" id="hf-api-key" placeholder="sk-ant-…" /></div>
        <button class="btn block" id="hf-save-key">Save key</button>
        <p style="font-size:12px;color:var(--color-text-dim);margin-top:12px;">Get a key at <strong>console.anthropic.com → API Keys</strong>.</p>
      </div>
    `;
  }

  function macroDeltaCellHtml(key, orig, heal) {
    const unit = key === "kcal" ? "" : "g";
    const d = heal[key] - orig[key];
    const good = key === "protein" ? d >= 0 : d <= 0;
    const sign = d > 0 ? "+" : "";
    return `<div style="font-weight:700;">${Math.round(heal[key])}${unit}<br/><span style="font-size:11px;font-weight:700;color:${good ? "var(--color-primary)" : "var(--color-danger)"}">${sign}${Math.round(d)}${unit}</span></div>`;
  }

  function healthifyResultHtml(r) {
    return `
      <div class="section-title">Macro comparison (per serving)</div>
      <div class="card">
        <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:10px 8px;align-items:center;text-align:center;">
          <div style="font-size:12px;font-weight:700;color:var(--color-text-dim);">ORIGINAL</div>
          <div></div>
          <div style="font-size:12px;font-weight:700;color:var(--color-primary);">HEALTHIER</div>
          ${["kcal", "protein", "carbs", "fat"]
            .map(
              (k) => `
            <div>${Math.round(r.originalMacros[k])}${k === "kcal" ? "" : "g"}</div>
            <div style="font-size:10.5px;color:var(--color-text-dim);text-transform:uppercase;">${k}</div>
            ${macroDeltaCellHtml(k, r.originalMacros, r.healthierMacros)}
          `
            )
            .join("")}
        </div>
      </div>

      <div class="section-title">What changed</div>
      <div class="card">
        <ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:7px;font-size:13.5px;line-height:1.4;">
          ${r.changesExplained.map((c) => `<li>${Util.escapeHtml(c)}</li>`).join("")}
        </ul>
      </div>

      <div class="section-title">Healthier version: ${Util.escapeHtml(r.recipeName || "Untitled recipe")}</div>
      <div class="card">
        <h3>Ingredients</h3>
        <ul class="ingredient-list">${r.healthierIngredients.map((i) => `<li><span>${Util.escapeHtml(i.name)}</span><span class="amt">${Util.escapeHtml(i.amount || "")}</span></li>`).join("")}</ul>
      </div>
      <div class="card">
        <h3>Instructions</h3>
        <ol class="instruction-list">${r.healthierInstructions.map((s) => `<li>${Util.escapeHtml(s)}</li>`).join("")}</ol>
      </div>

      <button class="btn block" id="hf-save-recipe" style="margin-bottom:28px">Save to my recipes</button>
    `;
  }

  function healthifyFormHtml() {
    const s = healthifyState;
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <h3 style="margin:0">Paste a recipe</h3>
          <button class="btn outline" id="hf-change-key" style="min-height:32px;padding:0 12px;font-size:12.5px;">Change key</button>
        </div>
        <p style="font-size:12.5px;color:var(--color-text-dim);margin-bottom:12px;">Paste the ingredients and instructions from any recipe. Claude will rewrite it to be higher-protein and lower in refined carbs, while keeping it recognizable.</p>
        <div class="field"><textarea id="hf-input" placeholder="Paste ingredients + instructions here…" style="min-height:160px">${Util.escapeHtml(s.inputText)}</textarea></div>
        <div class="field">
          <label>Or paste a URL <span style="font-weight:400;text-transform:none;">(best-effort — many sites block this)</span></label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="hf-url" value="${Util.escapeHtml(s.url)}" placeholder="https://…" style="flex:1;" />
            <button class="btn secondary" id="hf-fetch-url" style="min-height:44px;padding:0 14px;">Fetch</button>
          </div>
        </div>
        <button class="btn block" id="hf-submit" ${s.loading ? "disabled" : ""}>${s.loading ? "Healthifying…" : "✨ Healthify this recipe"}</button>
        ${s.error ? `<p style="color:var(--color-danger);font-size:13px;margin-top:12px;line-height:1.4;">${Util.escapeHtml(s.error)}</p>` : ""}
      </div>
      ${s.result ? healthifyResultHtml(s.result) : ""}
    `;
  }

  function paintHealthifyView() {
    const hasKey = !!healthifyApiKey;
    viewEl.innerHTML = hasKey ? healthifyFormHtml() : healthifyKeySetupHtml();

    if (!hasKey) {
      viewEl.querySelector("#hf-save-key").addEventListener("click", async () => {
        const input = viewEl.querySelector("#hf-api-key");
        const key = input.value.trim();
        if (!key) return showToast("Enter an API key");
        await Store.saveApiKey(key);
        healthifyApiKey = key;
        paintHealthifyView();
      });
      return;
    }

    viewEl.querySelector("#hf-change-key").addEventListener("click", async () => {
      await Store.saveApiKey("");
      healthifyApiKey = "";
      paintHealthifyView();
    });
    viewEl.querySelector("#hf-submit").addEventListener("click", () => submitHealthify());
    viewEl.querySelector("#hf-fetch-url").addEventListener("click", () => fetchHealthifyUrl());

    const saveBtn = viewEl.querySelector("#hf-save-recipe");
    if (saveBtn) saveBtn.addEventListener("click", () => saveHealthifiedRecipe(healthifyState.result));
  }

  async function submitHealthify() {
    healthifyState.inputText = viewEl.querySelector("#hf-input").value;
    healthifyState.url = viewEl.querySelector("#hf-url").value;
    const text = healthifyState.inputText.trim();
    if (!text) {
      healthifyState.error = "Paste a recipe first — ingredients and instructions.";
      paintHealthifyView();
      return;
    }
    healthifyState.loading = true;
    healthifyState.error = null;
    healthifyState.result = null;
    paintHealthifyView();
    try {
      const result = await Healthify.healthify(healthifyApiKey, text);
      healthifyState.result = result;
    } catch (e) {
      healthifyState.error = e.message || "Something went wrong. Please try again.";
    } finally {
      healthifyState.loading = false;
      paintHealthifyView();
    }
  }

  async function fetchHealthifyUrl() {
    healthifyState.inputText = viewEl.querySelector("#hf-input").value;
    const url = viewEl.querySelector("#hf-url").value.trim();
    healthifyState.url = url;
    if (!url) return;
    healthifyState.error = null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("fetch failed");
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const text = (doc.body && doc.body.innerText) || "";
      if (!text.trim()) throw new Error("empty");
      healthifyState.inputText = text.trim().slice(0, 6000);
      showToast("Fetched page text — review it before healthifying");
    } catch (e) {
      healthifyState.error = "Couldn't fetch that page automatically (likely blocked by the site's cross-origin policy). Please paste the recipe text below instead.";
    }
    paintHealthifyView();
  }

  async function saveHealthifiedRecipe(result) {
    const name = result.recipeName || "Healthified Recipe";
    const id = `${Util.slugify(name) || "healthified-recipe"}-${Util.uid("r").slice(-6)}`;
    const recipe = {
      id,
      name,
      category: Util.CATEGORIES.includes(result.category) ? result.category : "dinner",
      proteinSource: Util.PROTEIN_SOURCES.includes(result.proteinSource) ? result.proteinSource : "none",
      carbSource: Util.CARB_SOURCES.includes(result.carbSource) ? result.carbSource : "none",
      servings: Number(result.servings) || 1,
      ingredients: result.healthierIngredients.map((i) => ({ name: i.name, amount: i.amount, freeform: true })),
      instructions: result.healthierInstructions,
      macros: {
        kcal: Number(result.healthierMacros.kcal) || 0,
        protein: Number(result.healthierMacros.protein) || 0,
        carbs: Number(result.healthierMacros.carbs) || 0,
        fat: Number(result.healthierMacros.fat) || 0,
      },
    };
    await Store.saveCustomRecipe(recipe);
    const shareResult = await Store.postSharedRecipe(recipe);
    await invalidateRecipes();
    showToast(shareResultToast(shareResult));
    navigate(`recipe/${id}`);
  }

  // ---------------- Init ----------------
  function bindTabbar() {
    tabbarEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-route]");
      if (!btn) return;
      navigate(btn.dataset.route);
    });
  }

  function init() {
    bindTabbar();
    window.addEventListener("hashchange", router);
    router();
  }

  return { init, navigate, invalidateRecipes };
})();

document.addEventListener("DOMContentLoaded", App.init);
