/**
 * forgePowers.ts — THE ALLOWED POWER LIST the Forge picks from.
 *
 * The Forge used to ask a creator to type a power's name and description into
 * two free-text boxes, twice over, for up to four powers. That is eight fields
 * of prose to attach four powers, and every artifact ended up describing its
 * powers in different words. The operator's ask was blunt: "a person forging an
 * artifact should be able to install powers in it… just make drop down menus."
 *
 * So a power is now CHOSEN, not written. Each entry here is one option in the
 * Forge's power dropdowns; picking it stores exactly the `{ name, description }`
 * pair the server already accepts. That means:
 *   • nothing about the write contract changes — /api/fn/forge-artifact-save
 *     and the sanitizers in src/lib/forgeTiers.ts are untouched, and every
 *     entry below is well within FORGE_POWER_NAME_MAX / FORGE_POWER_DESC_MAX;
 *   • artifacts describe the same power the same way wherever they appear;
 *   • an artifact forged before this list existed still renders — ArtifactCard
 *     reads whatever `{ name, description }` pairs are stored, list or not.
 *
 * These are FLAVOUR, shown on the artifact wherever it appears. They carry no
 * mechanical effect — the powers that actually change play are the Conquest
 * recipes (src/lib/conquestArtifacts.ts), which the server derives itself and a
 * client can never author.
 *
 * Adding a power is a one-line change here; it appears in the dropdowns at once.
 */

export type ForgePowerOption = {
  /** Stable key for the <option> value and React keys. Never stored. */
  code: string
  /** What is stored as the power's name (≤ FORGE_POWER_NAME_MAX). */
  name: string
  /** What is stored as the power's description (≤ FORGE_POWER_DESC_MAX). */
  description: string
  /** Grouping label for the dropdown's <optgroup>. */
  group: 'Offense' | 'Defense' | 'Mobility' | 'Support' | 'Presence'
}

export const FORGE_POWER_OPTIONS: ForgePowerOption[] = [
  // ── Offense ──────────────────────────────────────────────────────────────
  {
    code: 'rasengan-surge',
    name: 'Rasengan Surge',
    description: 'A spiralling burst that sends the artifact\'s bearer into a fight swinging first.',
    group: 'Offense',
  },
  {
    code: 'blade-storm',
    name: 'Blade Storm',
    description: 'A flurry of strikes that keeps the pressure on until the opening appears.',
    group: 'Offense',
  },
  {
    code: 'ember-strike',
    name: 'Ember Strike',
    description: 'Every landed hit leaves a lingering burn on the target.',
    group: 'Offense',
  },
  {
    code: 'chakra-overload',
    name: 'Chakra Overload',
    description: 'Dumps the whole reserve into one committed, devastating attack.',
    group: 'Offense',
  },

  // ── Defense ──────────────────────────────────────────────────────────────
  {
    code: 'iron-guard',
    name: 'Iron Guard',
    description: 'A hardened stance that turns the first heavy blow of a round aside.',
    group: 'Defense',
  },
  {
    code: 'mirror-ward',
    name: 'Mirror Ward',
    description: 'Reflects a portion of what is thrown at the bearer back at the thrower.',
    group: 'Defense',
  },
  {
    code: 'stone-skin',
    name: 'Stone Skin',
    description: 'Slower, steadier, and far harder to knock out of position.',
    group: 'Defense',
  },

  // ── Mobility ─────────────────────────────────────────────────────────────
  {
    code: 'shadow-step',
    name: 'Shadow Step',
    description: 'Closes distance without being seen crossing it.',
    group: 'Mobility',
  },
  {
    code: 'wind-runner',
    name: 'Wind Runner',
    description: 'Sustained speed across open ground — first to the objective, every time.',
    group: 'Mobility',
  },
  {
    code: 'phase-dash',
    name: 'Phase Dash',
    description: 'A short blink through whatever is in the way.',
    group: 'Mobility',
  },

  // ── Support ──────────────────────────────────────────────────────────────
  {
    code: 'medic-seal',
    name: 'Medic Seal',
    description: 'Mends the bearer and whoever is standing with them.',
    group: 'Support',
  },
  {
    code: 'squad-rally',
    name: 'Squad Rally',
    description: 'Steadies the whole squad when the fight turns against them.',
    group: 'Support',
  },
  {
    code: 'chakra-well',
    name: 'Chakra Well',
    description: 'A deeper reserve that refills faster between exchanges.',
    group: 'Support',
  },

  // ── Presence ─────────────────────────────────────────────────────────────
  {
    code: 'kings-mark',
    name: "King's Mark",
    description: 'Marks the bearer as a titleholder wherever the artifact is shown.',
    group: 'Presence',
  },
  {
    code: 'clan-banner',
    name: 'Clan Banner',
    description: 'Flies the bearer\'s clan colours on the artifact and its listing.',
    group: 'Presence',
  },
  {
    code: 'legend-aura',
    name: 'Legend Aura',
    description: 'A visible aura that says this one was earned, not bought.',
    group: 'Presence',
  },
]

/** Dropdown group order — stable, so the menus never reshuffle. */
export const FORGE_POWER_GROUPS: ForgePowerOption['group'][] = [
  'Offense',
  'Defense',
  'Mobility',
  'Support',
  'Presence',
]

/** Look one up by the code a dropdown emitted. */
export function forgePowerByCode(code: string): ForgePowerOption | null {
  return FORGE_POWER_OPTIONS.find((option) => option.code === code) ?? null
}

/**
 * Turn the dropdown selections into the `{ name, description }` list the save
 * contract expects: unknown or empty codes drop out, and a power can only be
 * installed once (two dropdowns on the same power is a mis-click, not a
 * doubling — the UI also disables an already-chosen option).
 */
export function forgePowersFromCodes(codes: readonly string[]): { name: string; description: string }[] {
  const seen = new Set<string>()
  const powers: { name: string; description: string }[] = []
  for (const code of codes) {
    const option = forgePowerByCode(String(code || ''))
    if (!option || seen.has(option.code)) continue
    seen.add(option.code)
    powers.push({ name: option.name, description: option.description })
  }
  return powers
}
