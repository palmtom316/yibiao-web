export interface LedgerFields {
  version?: number;
  category?: string | null;
  certificateNo?: string | null;
  qualificationLevel?: string | null;
  holderName?: string | null;
  issuer?: string | null;
  validFrom?: string | null;
  validityKind?: 'dated' | 'permanent' | 'unknown';
  archivedAt?: string | null;
}
export function appendLedgerFields(form: FormData, input: LedgerFields) {
  for (const key of ['version', 'category', 'certificateNo', 'qualificationLevel', 'holderName', 'issuer', 'validFrom', 'validityKind'] as const) {
    if (input[key] !== undefined) form.append(key, String(input[key] ?? ''));
  }
}
