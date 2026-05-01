/**
 * src/rolls/skill-roll.mjs
 * ============================
 * Core roll logic for Roll for Shoes.
 *
 * STATUS: Milestone 5 placeholder.
 * The character sheet calls a stub roll in _onRollSkill for now.
 * This file gets fully implemented in Milestone 5.
 *
 * PLANNED API:
 *
 *   RfsSkillRoll.roll(actor, skill, options)
 *     - Rolls Nd6 where N = skill.level
 *     - Applies status modifiers to the total
 *     - Detects all-sixes (advancement trigger)
 *     - Compares against difficulty or opposed roll total
 *     - Posts a rich chat message with result
 *     - On failure: calls actor.addXp(1)
 *     - On all-sixes: triggers advancement prompt
 *
 *   RfsSkillRoll.opposed(actorA, skillA, actorB, skillB)
 *     - Rolls both actors simultaneously
 *     - Compares totals
 *     - Posts a combined chat card
 *
 *   RfsSkillRoll.rollVsDifficulty(actor, skill, difficulty)
 *     - Rolls actor's skill against a static difficulty number
 *     - Used for NPC fixed-mode opposition and GM-set thresholds
 *
 * OPTIONS shape:
 *   {
 *     flavor:     string,   // optional override for chat message flavor
 *     difficulty: number,   // static threshold (undefined = narrative only)
 *     spendXp:    boolean,  // true if the player is spending XP to boost
 *   }
 */

export class RfsSkillRoll {
  // Milestone 5
}
