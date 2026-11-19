import { useT } from '../hooks';

/** 重複の知らせの入力。 */
interface DuplicateNoticeProps {
  /** 最初のもの以外の、同じ条件のフィルタの数。 */
  readonly count: number;
}

/**
 * 同じ条件（種類、対象、属性）のフィルタが 2 つ以上あることを知らせる。
 *
 * 【なぜ】プロジェクトファイルなどからは、同じ属性のフィルタが別の ID で複数入りうる。
 * 部品が示すのは最初のフィルタだけで、操作もそれに対して行う。残りは「適用中のフィルタ」の
 * 一覧から個別に解除できることを伝え、黙って食い違わないようにする。
 *
 * @param props - 重複の数
 * @returns 知らせの要素。重複が無ければ何も描かない
 */
export function DuplicateNotice({ count }: DuplicateNoticeProps) {
  const t = useT();
  if (count <= 0) return null;
  return (
    <p className="hint" role="note">
      ! {t('filter.duplicate', { count })}
    </p>
  );
}
