/*
 * Pure computation: turn a week's planner slots into a real-world shopping
 * list. Ingredient quantities/costs are aggregated across the WHOLE week
 * through the shared ingredient table (data/ingredients.json), not
 * recalculated per-recipe, so the same chicken breast used in three
 * different recipes is bought once, in one real package size.
 */
const Shopping = (() => {
  // slots: { "dayIndex:mealType": [recipeId, ...] }
  function countPlannedServings(slots) {
    const counts = {}; // recipeId -> total servings planned this week
    Object.values(slots).forEach((recipeIds) => {
      (recipeIds || []).forEach((id) => {
        counts[id] = (counts[id] || 0) + 1;
      });
    });
    return counts;
  }

  function buildList(slots, recipesById, ingredientsById, familyMultiplier) {
    const servingCounts = countPlannedServings(slots);
    const totals = {}; // ingredientId -> raw amount needed
    const freeformMap = {}; // "name" -> { name, recipes: Set }

    Object.entries(servingCounts).forEach(([recipeId, count]) => {
      const recipe = recipesById[recipeId];
      if (!recipe) return;
      const perServingMultiplier = count / recipe.servings;
      recipe.ingredients.forEach((line) => {
        if (line.freeform) {
          const key = line.name;
          if (!freeformMap[key]) freeformMap[key] = { name: line.name, recipeNames: new Set() };
          freeformMap[key].recipeNames.add(recipe.name);
          return;
        }
        const amount = line.amount * perServingMultiplier * familyMultiplier;
        totals[line.id] = (totals[line.id] || 0) + amount;
      });
    });

    const itemsBySection = {};
    Util.GROCERY_SECTIONS.forEach((s) => (itemsBySection[s] = []));

    Object.entries(totals).forEach(([ingredientId, rawAmount]) => {
      const ing = ingredientsById[ingredientId];
      if (!ing || rawAmount <= 0) return;
      const packages = Math.max(1, Math.ceil(rawAmount / ing.package.size - 1e-9));
      const cost = packages * ing.package.price;
      const buyLabel = packages > 1 ? `${packages} × ${ing.package.label}` : ing.package.label;
      const rawLabel = ing.unit === "each" ? `needs ${Util.formatNum(rawAmount, 1)}` : `needs ${Util.formatNum(rawAmount)} g`;
      itemsBySection[ing.section].push({
        key: ingredientId,
        name: ing.name,
        buyLabel,
        rawLabel,
        packages,
        cost,
      });
    });

    Object.values(freeformMap).forEach((item) => {
      itemsBySection.other.push({
        key: "freeform:" + Util.slugify(item.name),
        name: item.name,
        buyLabel: "check recipe for amount",
        rawLabel: `used in ${[...item.recipeNames].join(", ")}`,
        packages: null,
        cost: 0,
      });
    });

    Util.GROCERY_SECTIONS.forEach((s) => itemsBySection[s].sort((a, b) => a.name.localeCompare(b.name)));

    const sections = Util.GROCERY_SECTIONS.map((s) => ({ section: s, items: itemsBySection[s] })).filter((s) => s.items.length);
    const totalCost = sections.reduce((sum, s) => sum + s.items.reduce((s2, i) => s2 + i.cost, 0), 0);
    const isEmpty = Object.keys(servingCounts).length === 0;

    return { sections, totalCost, isEmpty };
  }

  return { buildList };
})();
