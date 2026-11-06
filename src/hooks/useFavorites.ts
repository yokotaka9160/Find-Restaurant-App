// 副作用フック useEffect と状態フック useState を読み込む
import { useEffect, useState } from "react"

// お気に入りの件数の上限を読み込む
import { FAVORITES_MAX } from "@/data/restaurants"

/** localStorage に保存するときのキー */
const STORAGE_KEY = "findrestr:favorites"

/**
 * localStorage からお気に入りの店舗 ID を読み込む。
 * @returns 店舗 ID の配列（新しく登録した順）。保存がない・壊れている・読めない環境では空配列
 */
function load(): string[] {
  try {
    // 保存された JSON を読む（なければ空配列）
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")
    // 配列でなければ空配列、配列なら文字列だけを残す
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
  } catch {
    // プライベートモードなどで localStorage が使えない、または JSON が壊れている
    return []
  }
}

/**
 * お気に入りの店舗 ID を localStorage に保存する。
 * @param ids 店舗 ID の配列
 * @returns なし
 */
function save(ids: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // 保存できない環境では、ページを開いている間だけ保持する
  }
}

/**
 * お気に入りの店舗をブラウザ（localStorage）に保存・管理する。
 * Yelp の利用規約により、店舗 ID 以外のデータは保存しない（表示時に /api/shops/lookup で取得する）。
 * @returns ids: 店舗 ID（新しく登録した順）/ isFavorite: 登録済みか / canAdd: まだ登録できるか /
 *          toggle: 登録・解除を切り替える / remove: まとめて解除する
 */
export function useFavorites() {
  // お気に入りの店舗 ID（初期値は localStorage から読む）
  const [ids, setIds] = useState<string[]>(load)

  // 別のタブで変更されたら、このタブにも反映する
  useEffect(() => {
    // storage イベントは、ほかのタブで localStorage が変わったときに届く
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setIds(load())
    }
    window.addEventListener("storage", onStorage)
    // アンマウント時に購読を解除する
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  /**
   * 状態を更新し、localStorage にも保存する。
   * @param next 前の ID 配列から新しい ID 配列を作る関数
   * @returns なし
   */
  const update = (next: (prev: string[]) => string[]) =>
    setIds((prev) => {
      const value = next(prev)
      save(value)
      return value
    })

  /**
   * 登録済みかどうか。
   * @param id 店舗 ID
   * @returns 登録済みなら true
   */
  const isFavorite = (id: string) => ids.includes(id)

  /**
   * 登録・解除を切り替える（上限に達しているときは登録しない）。
   * @param id 店舗 ID
   * @returns なし
   */
  const toggle = (id: string) =>
    update((prev) =>
      prev.includes(id)
        ? prev.filter((v) => v !== id) // 登録済みなら外す
        : prev.length < FAVORITES_MAX
          ? [id, ...prev] // 未登録なら先頭に追加する
          : prev, // 上限なら何もしない
    )

  /**
   * 複数の店舗をまとめて解除する（情報を取得できなくなった店舗の整理に使う）。
   * @param remove 解除する店舗 ID の配列
   * @returns なし
   */
  const remove = (remove: string[]) => update((prev) => prev.filter((v) => !remove.includes(v)))

  // 状態と操作関数を返す
  return { ids, isFavorite, canAdd: ids.length < FAVORITES_MAX, toggle, remove }
}
