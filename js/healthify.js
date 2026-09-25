/*
 * Calls the Claude API directly from the browser to turn a pasted recipe
 * into a healthier version. This is the one feature in the app that needs
 * network access — everything else works fully offline. The API key lives
 * only in this browser's localStorage and is sent only to Anthropic's API.
 */
const Healthify = (() => {
  const SYSTEM_PROMPT = `You are a nutrition assistant. You take a home-cook recipe (ingredients and instructions, pasted as raw text, possibly messy) and produce a healthier, higher-protein / lower-refined-carb version of it while keeping the dish clearly recognizable as the same meal — e.g. swap sour cream for plain Greek yogurt, ground beef for lean ground turkey or 93% lean beef, white pasta/bread/rice for whole grain versions, reduce added sugar and oil where reasonable, add a lean protein boost if the dish is protein-light.

Respond with ONLY a single JSON object — no markdown code fences, no commentary before or after — matching exactly this shape:
{
  "recipeName": "short name for the dish",
  "category": "one of: breakfast, lunch, dinner, snack, dessert, drink",
  "proteinSource": "one of: chicken, beef, turkey, pork, fish, shellfish, egg, dairy, protein_powder, plant, mixed, none",
  "carbSource": "one of: oats, rice, bread, tortilla, potato, pasta, quinoa, fruit, legume, none, mixed",
  "servings": number,
  "originalMacros": { "kcal": number, "protein": number, "carbs": number, "fat": number },
  "healthierIngredients": [ { "name": "specific ingredient with type, e.g. '2% plain Greek yogurt'", "amount": "e.g. '1 cup'" } ],
  "healthierInstructions": [ "step 1", "step 2" ],
  "healthierMacros": { "kcal": number, "protein": number, "carbs": number, "fat": number },
  "changesExplained": [ "short sentence describing one swap and why, e.g. 'Swapped sour cream for plain Greek yogurt to add protein and cut fat'" ]
}

All macro numbers are PER SERVING (servings = the servings field above), estimated as accurately as you can from standard nutrition data for the ingredients and amounts given. Keep the healthier version recognizable as the same dish — this is a lightened-up version, not a different recipe.`;

  function stripCodeFences(text) {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    return cleaned.trim();
  }

  function parseResponse(text) {
    const cleaned = stripCodeFences(text);
    let json;
    try {
      json = JSON.parse(cleaned);
    } catch (e) {
      throw new Error("Claude's response wasn't valid JSON. Please try again.");
    }
    const required = ["originalMacros", "healthierIngredients", "healthierInstructions", "healthierMacros", "changesExplained"];
    for (const key of required) {
      if (!(key in json)) throw new Error(`The response was missing "${key}". Please try again.`);
    }
    return json;
  }

  async function healthify(apiKey, recipeText) {
    if (!apiKey) throw new Error("No API key configured.");
    if (!recipeText || !recipeText.trim()) throw new Error("Paste a recipe first — ingredients and instructions.");

    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: recipeText }],
        }),
      });
    } catch (e) {
      throw new Error("Network request failed. Check your connection and try again.");
    }

    if (!res.ok) {
      if (res.status === 401) throw new Error("Invalid API key. Update it and try again.");
      if (res.status === 429) throw new Error("Rate limited by the API. Wait a moment and try again.");
      let msg = `Request failed (HTTP ${res.status}).`;
      try {
        const errJson = await res.json();
        if (errJson && errJson.error && errJson.error.message) msg = errJson.error.message;
      } catch (e) {
        /* ignore parse failure, use default message */
      }
      throw new Error(msg);
    }

    const data = await res.json();
    const text = data && data.content && data.content[0] && data.content[0].text;
    if (!text) throw new Error("Empty response from the API.");
    return parseResponse(text);
  }

  return { healthify };
})();
