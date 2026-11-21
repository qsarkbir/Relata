import { VALUE_TYPES } from '../../core/model';
import type { ValueType } from '../../core/model';
import { useT } from '../hooks';
import type { ColumnDraft, ImportDraft, TableTarget } from './model';
import { columnRoles, columnType } from './model';
import { ROLE_NAMES } from './messages';
/** 列の型・暦・区切り・用途の編集。 */
interface ColumnsProps {
  readonly draft: ImportDraft;
  readonly target: TableTarget;
  readonly label: string;
  readonly onChange: (draft: ImportDraft) => void;
}
/**
 * 元の全列について対応を変更できる表。
 * @param props - 編集中の表と更新通知
 * @returns 列設定
 */
export function Columns({ draft, target, label, onChange }: ColumnsProps) {
  const t = useT();
  const change = (index: number, patch: Partial<ColumnDraft>): void => {
    onChange({
      ...draft,
      columns: draft.columns.map((column, position) =>
        position === index ? { ...column, ...patch } : column,
      ),
    });
  };
  return (
    <fieldset>
      <legend>{label}</legend>
      <p>{t('import.columnsHint')}</p>
      <div className="import-table-wrap">
        <table>
          <thead>
            <tr>
              {['column', 'use', 'key', 'label', 'type', 'calendar', 'separator'].map((key) => (
                <th key={key} scope="col">
                  {key === 'column'
                    ? t('import.column')
                    : key === 'use'
                      ? t('import.use')
                      : key === 'key'
                        ? t('import.key')
                        : key === 'label'
                          ? t('import.label')
                          : key === 'type'
                            ? t('import.type')
                            : key === 'calendar'
                              ? t('import.calendar')
                              : t('import.separator')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.columns.map((column, index) => {
              const attribute = ['attr', 'sourceAttr', 'targetAttr', 'edgeAttr'].includes(
                column.role,
              );
              const prefix =
                label + ' ' + String(index + 1) + ' ' + (draft.table.headers[index] ?? '');
              return (
                <tr key={index}>
                  <th scope="row">
                    <bdi>{draft.table.headers[index]}</bdi>
                  </th>
                  <td>
                    <select
                      aria-label={prefix + ' ' + t('import.use')}
                      value={column.role}
                      onChange={(event) => {
                        const role = columnRoles(target).find(
                          (value) => value === event.currentTarget.value,
                        );
                        if (role !== undefined)
                          change(index, { role, type: columnType(role, column.type) });
                      }}
                    >
                      {columnRoles(target).map((role) => (
                        <option key={role} value={role}>
                          {t(ROLE_NAMES[role])}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={prefix + ' ' + t('import.key')}
                      disabled={!attribute}
                      value={column.key}
                      onChange={(event) => {
                        change(index, { key: event.currentTarget.value });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={prefix + ' ' + t('import.label')}
                      disabled={!attribute}
                      value={column.label}
                      onChange={(event) => {
                        change(index, { label: event.currentTarget.value });
                      }}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={prefix + ' ' + t('import.type')}
                      disabled={!attribute}
                      value={column.type}
                      onChange={(event) => {
                        const type: ValueType | undefined = VALUE_TYPES.find(
                          (value) => value === event.currentTarget.value,
                        );
                        if (type !== undefined) change(index, { type });
                      }}
                    >
                      {VALUE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {t(
                            type === 'string'
                              ? 'import.type.string'
                              : type === 'number'
                                ? 'import.type.number'
                                : type === 'date'
                                  ? 'import.type.date'
                                  : type === 'boolean'
                                    ? 'import.type.boolean'
                                    : 'import.type.category',
                          )}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={prefix + ' ' + t('import.calendar')}
                      value={column.calendar}
                      disabled={
                        column.type !== 'date' && !['date', 'start', 'end'].includes(column.role)
                      }
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        if (value === 'gregorian' || value === 'hijri')
                          change(index, { calendar: value });
                      }}
                    >
                      <option value="gregorian">{t('import.gregorian')}</option>
                      <option value="hijri">{t('import.hijri')}</option>
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={prefix + ' ' + t('import.separator')}
                      disabled={!attribute}
                      value={column.separator}
                      onChange={(event) => {
                        change(index, { separator: event.currentTarget.value });
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </fieldset>
  );
}
