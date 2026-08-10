export function nextMultiSelection(
  current: number[],
  heldIndex: number,
  anchorIndex: number,
): number[] {
  const selected = [...new Set(current.filter((index) => Number.isInteger(index) && index >= 0))]

  if (selected.length === 0) {
    return [...new Set([anchorIndex, heldIndex].filter((index) => Number.isInteger(index) && index >= 0))]
      .sort((a, b) => a - b)
  }

  if (selected.includes(heldIndex)) {
    return selected.length === 1 ? selected : selected.filter((index) => index !== heldIndex)
  }

  return [...selected, heldIndex].sort((a, b) => a - b)
}
