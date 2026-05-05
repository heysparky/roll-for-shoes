/**
 * src/helpers/templates.mjs
 * =============================
 * Preloads Handlebars partials and registers system-wide Handlebars helpers.
 *
 * Preloading prevents flash-of-unstyled-content on first sheet open, and
 * makes partials available by name (e.g. {{> "systems/roll-for-shoes/..."}} ).
 */

/**
 * Preload all Handlebars templates used by the system.
 * Returns a Promise that resolves when all templates are cached.
 */
export async function preloadHandlebarsTemplates() {
  const templates = [
    // Actor sheets
    "systems/roll-for-shoes/templates/actor/character-sheet.hbs",
    "systems/roll-for-shoes/templates/actor/npc-sheet.hbs",
    "systems/roll-for-shoes/templates/dialog/challenge-dialog.hbs",
    "systems/roll-for-shoes/templates/dialog/challenge-player-dialog.hbs",

    // Partials — loaded once, referenced as {{> "path"}} in other templates
    "systems/roll-for-shoes/templates/actor/partials/skill-tree.hbs",
    "systems/roll-for-shoes/templates/actor/partials/skill-node.hbs",
    "systems/roll-for-shoes/templates/actor/partials/status-list.hbs",
    "systems/roll-for-shoes/templates/actor/partials/xp-tracker.hbs",
  ];

  // v14: loadTemplates is namespaced under foundry.applications.handlebars
  return foundry.applications.handlebars.loadTemplates(templates);
}

/**
 * Register Handlebars helpers that are used across sheet templates.
 * Called after preloadHandlebarsTemplates resolves.
 */
export function registerHandlebarsHelpers() {

  /**
   * {{rfsRepeat n}} — outputs a string of n die icons for visual flair.
   * Usage: {{rfsRepeat skill.level}} renders N ⚙ icons in the sheet.
   */
  Handlebars.registerHelper("rfsRepeat", function (count, options) {
    let out = "";
    for (let i = 0; i < count; i++) out += options.fn(i);
    return out;
  });

  /**
   * {{rfsIsRoot skill}} — true if this is the "Do Anything" root skill.
   * Used to prevent the delete button from rendering on the root skill.
   */
  Handlebars.registerHelper("rfsIsRoot", function (skill) {
    return skill.parentId === null || skill.parentId === "";
  });

  /**
   * {{rfsChildrenOf skills parentId}} — filters skills to direct children.
   * Used by the recursive skill-node partial to build the tree.
   */
  Handlebars.registerHelper("rfsChildrenOf", function (skills, parentId) {
    return skills.filter((s) => s.parentId === parentId);
  });

  /**
   * {{rfsSignedNumber n}} — formats a number with an explicit sign.
   * Used for statuses: +2 Clean Shoe, -3 Broken Nose.
   */
  Handlebars.registerHelper("rfsSignedNumber", function (n) {
    return n >= 0 ? `+${n}` : `${n}`;
  });

  /**
   * {{rfsLocalise key}} — alias for localize that namespaces to RFS.
   * Shorthand so templates don't have to write full key paths.
   */
  Handlebars.registerHelper("rfsLocalise", function (key) {
    return game.i18n.localize(`RFS.${key}`);
  });

  /**
   * {{add a b}} — adds two numbers together.
   * Used by skill-node.hbs to increment depth on each recursive call.
   */
  Handlebars.registerHelper("add", function (a, b) {
    return a + b;
  });

  /**
   * {{eq a b}} — strict equality check.
   * Used by skill-node.hbs to match child skills to their parent id.
   * Also useful anywhere a template needs to compare two values.
   */
  Handlebars.registerHelper("eq", function (a, b) {
    return a === b;
  });
}
