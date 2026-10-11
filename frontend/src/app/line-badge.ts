const numberedCategories = new Set(['IC', 'IR', 'S', 'SN', 'RE', 'R']);
const categories = new Set([
  ...numberedCategories,
  'EC',
  'EN',
  'ICE',
  'NJ',
  'PE',
  'RJ',
  'RJX',
  'TGV',
  'TER',
  'RB',
]);

/** Only resolve exact matches to bundled, unmodified SBB timetable badges. */
export function getLineBadgePath(
  categoryValue: string | null | undefined,
  numberValue: string | null | undefined,
): string | null {
  const category = categoryValue?.trim().toUpperCase();
  const number = numberValue?.trim();

  if (!category || !categories.has(category)) {
    return null;
  }

  if (!number) {
    return `icons/sbb-lines/${category.toLowerCase()}.svg`;
  }

  // The API can return a train number here. Do not truncate it or strip leading
  // zeroes: that could turn a train identifier into an unrelated line badge.
  if (numberedCategories.has(category) && /^[1-9]\d?$/.test(number)) {
    return `icons/sbb-lines/${category.toLowerCase()}-${number}.svg`;
  }

  return null;
}
