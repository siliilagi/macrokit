/**
 * MacroKit shared recipe backend.
 *
 * Setup:
 * 1. Create a new Google Sheet.
 * 2. Rename the first tab to exactly: Recipes
 * 3. In row 1, add these headers (one per column, A through J):
 *    id | name | category | proteinSource | carbSource | servings | ingredients | instructions | macros | addedAt
 * 4. Extensions -> Apps Script. Delete any starter code and paste this whole file in.
 * 5. Deploy -> New deployment -> type "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Click Deploy, authorize when prompted, and copy the Web App URL.
 * 7. Paste that URL into data/shared-config.json as "apiUrl" in the MacroKit project,
 *    then commit + push so it's live for every visitor.
 *
 * Every "Add a custom recipe" (and Healthify "Save to my recipes") in the app will
 * then append a row here, and every visitor's app will read all rows on load.
 */

const SHEET_NAME = "Recipes";
const HEADERS = ["id", "name", "category", "proteinSource", "carbSource", "servings", "ingredients", "instructions", "macros", "addedAt"];

function getSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('No sheet tab named "' + SHEET_NAME + '" found.');
  return sheet;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const sheet = getSheet_();
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return jsonOut_([]);

    const headers = values[0];
    const rows = values.slice(1);
    const recipes = rows
      .filter((row) => row[0]) // skip fully blank rows
      .map((row) => {
        const obj = {};
        headers.forEach((h, i) => (obj[h] = row[i]));
        ["ingredients", "instructions", "macros"].forEach((field) => {
          if (typeof obj[field] === "string") {
            try {
              obj[field] = JSON.parse(obj[field]);
            } catch (err) {
              obj[field] = field === "instructions" ? [] : field === "ingredients" ? [] : { kcal: 0, protein: 0, carbs: 0, fat: 0 };
            }
          }
        });
        obj.servings = Number(obj.servings) || 1;
        return obj;
      });

    return jsonOut_(recipes);
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const recipe = body.recipe;
    if (!recipe || !recipe.id || !recipe.name) {
      return jsonOut_({ ok: false, error: "Missing recipe data." });
    }

    const sheet = getSheet_();

    // Make sure headers exist on a brand-new sheet.
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    }

    // Avoid duplicate ids (e.g. a retried request).
    const existingIds = sheet.getDataRange().getValues().slice(1).map((r) => r[0]);
    if (existingIds.indexOf(recipe.id) !== -1) {
      return jsonOut_({ ok: true, note: "Already present." });
    }

    sheet.appendRow([
      recipe.id,
      recipe.name,
      recipe.category || "",
      recipe.proteinSource || "none",
      recipe.carbSource || "none",
      recipe.servings || 1,
      JSON.stringify(recipe.ingredients || []),
      JSON.stringify(recipe.instructions || []),
      JSON.stringify(recipe.macros || { kcal: 0, protein: 0, carbs: 0, fat: 0 }),
      new Date().toISOString(),
    ]);

    return jsonOut_({ ok: true });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}
