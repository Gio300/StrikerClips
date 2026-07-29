/**
 * UI primitives — the button-first, art-rich building blocks.
 *
 *   ActionCard   — big tappable button-card (icon + one-word label + states)
 *   NinjaIcon    — original ninja + app SVG icon set (currentColor)
 *   StepFlow/Step— numbered required steps + collapsed "+ Add …" optional steps
 *   Drawer       — bottom-sheet / side slide-over (backdrop, scroll-lock)
 *   Menu         — small dropdown of actions
 *   ChipInput    — "type once, then tap" remembered free-text field
 *   AvailabilityHint — inline "✓ available / ✗ taken" line + suggestion chips
 *   Avatar       — a person's picture, or a clean initials circle in brand colors
 */

export { ActionCard, type ActionCardProps, type ActionCardAccent } from './ActionCard'
export { NinjaIcon, NINJA_ICON_NAMES, type NinjaIconName, type NinjaIconProps } from './NinjaIcon'
export { StepFlow, Step, type StepFlowProps, type StepProps } from './StepFlow'
export { Drawer, type DrawerProps, type DrawerSide } from './Drawer'
export { Menu, type MenuProps, type MenuItem } from './Menu'
export {
  ChipInput,
  readChips,
  addChip,
  removeChip,
  type ChipInputProps,
} from './ChipInput'
export { AvailabilityHint, type AvailabilityHintProps } from './AvailabilityHint'
export { Avatar, type AvatarProps } from './Avatar'
