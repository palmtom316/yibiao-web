export function ledgerFields(fields: Record<string, string | string[]>, personnel = false): Record<string, string | null> {
  const keys = ['certificateNo', 'qualificationLevel', 'issuer', 'validFrom', 'validityKind'];
  if (!personnel) keys.push('category', 'holderName');
  const result: Record<string, string | null> = {};
  for (const key of keys) if (fields[key] !== undefined) result[key] = String(Array.isArray(fields[key]) ? fields[key][0] : fields[key]) || null;
  return result;
}
