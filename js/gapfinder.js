/*
 * Given a pool of candidate recipes and remaining macro targets, finds the
 * single recipes and 2-3 item combinations that land closest to those
 * targets. Combo search is restricted to the best-scoring single items
 * (comboPoolSize) so it stays fast even with a large candidate pool.
 */
const GapFinder = (() => {
  function scoreMacros(actual, target) {
    const dp = actual.protein - target.protein;
    const dc = actual.carbs - target.carbs;
    const df = actual.fat - target.fat;
    return Math.abs(dp) / Math.max(target.protein, 1) + Math.abs(dc) / Math.max(target.carbs, 1) + Math.abs(df) / Math.max(target.fat, 1);
  }

  function sumMacros(recipeList) {
    return recipeList.reduce(
      (acc, r) => ({
        kcal: acc.kcal + r.macros.kcal,
        protein: acc.protein + r.macros.protein,
        carbs: acc.carbs + r.macros.carbs,
        fat: acc.fat + r.macros.fat,
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 }
    );
  }

  function findMatches(candidates, target, { comboPoolSize = 30, maxResults = 8 } = {}) {
    const singles = candidates.map((r) => ({ items: [r], macros: r.macros, score: scoreMacros(r.macros, target) })).sort((a, b) => a.score - b.score);

    const pool = singles.slice(0, comboPoolSize).map((s) => s.items[0]);
    const combos = [];
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const pairMacros = sumMacros([pool[i], pool[j]]);
        combos.push({ items: [pool[i], pool[j]], macros: pairMacros, score: scoreMacros(pairMacros, target) });
        for (let k = j + 1; k < pool.length; k++) {
          const tripleMacros = sumMacros([pool[i], pool[j], pool[k]]);
          combos.push({ items: [pool[i], pool[j], pool[k]], macros: tripleMacros, score: scoreMacros(tripleMacros, target) });
        }
      }
    }
    combos.sort((a, b) => a.score - b.score);

    return {
      singles: singles.slice(0, maxResults),
      combos: combos.slice(0, maxResults),
    };
  }

  return { findMatches, scoreMacros, sumMacros };
})();
