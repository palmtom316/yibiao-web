import type { LedgerFields } from '../types/ledger';
export default function LedgerFieldsEditor({ value, onChange, personnel = false }: { value: LedgerFields; onChange: (value: LedgerFields) => void; personnel?: boolean }) {
  const fields = [...(personnel ? [] : [['category', '资料类别'], ['holderName', '持有人 / 单位']]), ['certificateNo', '证号'], ['qualificationLevel', '资质等级'], ['issuer', '颁发单位'], ['validFrom', '生效日期']];
  return <fieldset className="ledger-fields"><legend>证照台账</legend>
    <p>未知字段可以留空，商务核验时会显示“资料不足”。</p>
    {fields.map(([key, label]) => <label className="asset-field" key={key}><span>{label}</span>{key === 'category' ? <select aria-label="资料类别" className="asset-field-input" value={value.category || ''} onChange={(event) => onChange({ ...value, category: event.target.value })}><option value="">请选择资料类型</option>{[...new Set(['营业执照', '公司资质', '管理体系认证', '安全生产许可', '专利软著', '业绩原件', '工具证明', '其他资料', ...(value.category ? [value.category] : [])])].map((category) => <option value={category} key={category}>{category}</option>)}</select> : <input className="asset-field-input" type={key === 'validFrom' ? 'date' : 'text'} value={String(value[key as keyof LedgerFields] || '').slice(0, key === 'validFrom' ? 10 : undefined)} onChange={(event) => onChange({ ...value, [key]: event.target.value })} />}</label>)}
    <label className="asset-field"><span>有效期类型</span><select aria-label="有效期类型" className="asset-field-input" value={value.validityKind || 'unknown'} onChange={(event) => onChange({ ...value, validityKind: event.target.value as LedgerFields['validityKind'] })}>
      <option value="unknown">未知 / 待核验</option><option value="dated">有期限（须填到期日）</option><option value="permanent">已确认永久有效</option>
    </select></label>
  </fieldset>;
}
