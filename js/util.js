const Util = (() => {
  const CATEGORIES = ["breakfast", "lunch", "dinner", "snack", "dessert", "drink"];
  const CATEGORY_LABELS = {
    breakfast: "Breakfast",
    lunch: "Lunch",
    dinner: "Dinner",
    snack: "Snack",
    dessert: "Dessert",
    drink: "Drink",
  };
  const CATEGORY_ICONS = {
    breakfast: "🍳",
    lunch: "🥗",
    dinner: "🍽️",
    snack: "🍎",
    dessert: "🍰",
    drink: "🥤",
  };

  const PROTEIN_SOURCES = ["chicken", "beef", "turkey", "pork", "fish", "shellfish", "egg", "dairy", "protein_powder", "plant", "mixed", "none"];
  const PROTEIN_SOURCE_LABELS = {
    chicken: "Chicken",
    beef: "Beef",
    turkey: "Turkey",
    pork: "Pork",
    fish: "Fish",
    shellfish: "Shellfish",
    egg: "Egg",
    dairy: "Dairy",
    protein_powder: "Protein powder",
    plant: "Plant-based",
    mixed: "Mixed",
    none: "None",
  };

  const CARB_SOURCES = ["oats", "rice", "bread", "tortilla", "potato", "pasta", "quinoa", "fruit", "legume", "none", "mixed"];
  const CARB_SOURCE_LABELS = {
    oats: "Oats",
    rice: "Rice",
    bread: "Bread",
    tortilla: "Tortilla",
    potato: "Potato",
    pasta: "Pasta",
    quinoa: "Quinoa",
    fruit: "Fruit",
    legume: "Legume",
    none: "None",
    mixed: "Mixed",
  };

  function slugify(text) {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  function uid(prefix) {
    return `${prefix || "id"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function round(n, digits = 0) {
    const f = Math.pow(10, digits);
    return Math.round(n * f) / f;
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // Given an ingredient line { id, amount } or { name, amount, freeform }
  // and the ingredients-by-id map, return a display-friendly {name, amountText}.
  function formatIngredientLine(line, ingredientsById) {
    if (line.freeform || !ingredientsById[line.id]) {
      return { name: line.name || "Unknown ingredient", amountText: String(line.amount) };
    }
    const ing = ingredientsById[line.id];
    let amountText;
    if (ing.unit === "each") {
      amountText = `${formatNum(line.amount)}×`;
    } else {
      amountText = line.amount >= 1000 ? `${formatNum(line.amount / 1000, 2)} kg` : `${formatNum(line.amount)} g`;
    }
    return { name: ing.name, amountText };
  }

  function formatNum(n, digits = 0) {
    const r = round(n, digits);
    return Number.isInteger(r) ? String(r) : r.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------------- Meal slots / grocery sections ----------------
  const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "dessert", "drink"];
  const MEAL_TYPE_LABELS = CATEGORY_LABELS; // same vocabulary as recipe categories
  const MEAL_TYPE_ICONS = CATEGORY_ICONS;

  const GROCERY_SECTIONS = ["protein", "grains", "produce", "dairy", "pantry", "other"];
  const GROCERY_SECTION_LABELS = {
    protein: "Protein",
    grains: "Grains",
    produce: "Produce",
    dairy: "Dairy",
    pantry: "Pantry",
    other: "Other",
  };
  const GROCERY_SECTION_ICONS = {
    protein: "🥩",
    grains: "🌾",
    produce: "🥬",
    dairy: "🧀",
    pantry: "🥫",
    other: "🧺",
  };

  // ---------------- Dates / weeks (Monday-start) ----------------
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function startOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 = Sunday
    const diff = day === 0 ? -6 : 1 - day;
    return addDays(d, diff);
  }

  function getWeekDates(weekStartISO) {
    const start = new Date(weekStartISO + "T00:00:00");
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }

  function formatWeekRangeLabel(weekStartISO) {
    const dates = getWeekDates(weekStartISO);
    const opts = { month: "short", day: "numeric" };
    const startLabel = dates[0].toLocaleDateString(undefined, opts);
    const endLabel = dates[6].toLocaleDateString(undefined, { ...opts, year: "numeric" });
    return `${startLabel} – ${endLabel}`;
  }

  return {
    CATEGORIES,
    CATEGORY_LABELS,
    CATEGORY_ICONS,
    PROTEIN_SOURCES,
    PROTEIN_SOURCE_LABELS,
    CARB_SOURCES,
    CARB_SOURCE_LABELS,
    MEAL_TYPES,
    MEAL_TYPE_LABELS,
    MEAL_TYPE_ICONS,
    GROCERY_SECTIONS,
    GROCERY_SECTION_LABELS,
    GROCERY_SECTION_ICONS,
    DAY_NAMES,
    slugify,
    uid,
    round,
    debounce,
    formatIngredientLine,
    formatNum,
    escapeHtml,
    toISODate,
    addDays,
    startOfWeek,
    getWeekDates,
    formatWeekRangeLabel,
  };
})();
