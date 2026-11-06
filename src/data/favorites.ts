/**
 * お気に入りの一覧の絞り込み・並び替え。
 *
 * お気に入りは最大 FAVORITES_MAX 件で、店舗情報はすでにブラウザに読み込んでいるため、
 * 検索画面（バックエンドで絞り込む）と違い、ここではブラウザ側で絞り込む。
 * 条件の意味は backend/shops.py の filter_shops と合わせている。
 */

// 都道府県の一覧（並び順に使う）
import { PREFECTURES } from "@/data/areas"
// 検索条件の範囲・初期値と、店舗・ジャンル・座標の型
import {
  ALL_AREAS,
  BUDGET_MAX,
  BUDGET_MIN,
  RADIUS_MAX_KM,
  RATING_MAX,
  RATING_MIN,
  type GenreFacet,
  type GeoPoint,
  type Restaurant,
} from "@/data/restaurants"

/** お気に入りの絞り込み条件 */
export interface FavoriteFilters {
  /** 都道府県。ALL_AREAS ならすべて */
  prefecture: string
  /** 市区町村。ALL_AREAS なら都道府県全域 */
  area: string
  /** 現在地。設定されているときは prefecture / area より優先し、半径で絞り込む */
  currentLocation: GeoPoint | null
  /** 現在地からの半径（km） */
  radiusKm: number
  /** 1人あたり予算の範囲 [下限, 上限]（円）。上限が BUDGET_MAX なら上限なし */
  budget: [number, number]
  /** 選択ジャンル（Category.alias）。空配列は「指定なし」。複数は OR 条件 */
  genres: string[]
  /** 評価の範囲 [下限, 上限] */
  rating: [number, number]
  /** true なら駐車場ありの店だけ */
  parking: boolean
  /** true なら大人数（4人以上）OK の店だけ */
  groups: boolean
}

/** 絞り込み条件の初期値（すべて指定なし） */
export const DEFAULT_FAVORITE_FILTERS: FavoriteFilters = {
  prefecture: ALL_AREAS,
  area: ALL_AREAS,
  currentLocation: null,
  radiusKm: RADIUS_MAX_KM,
  budget: [BUDGET_MIN, BUDGET_MAX],
  genres: [],
  rating: [RATING_MIN, RATING_MAX],
  parking: false,
  groups: false,
}

/**
 * 2 点間の距離（m、ハーバーサイン）。backend/shops.py の distance_m と同じ計算。
 * @param a 1 点目
 * @param b 2 点目
 * @returns 大円距離（m）
 */
export function distanceM(a: GeoPoint, b: GeoPoint): number {
  // 地球の半径（m）
  const r = 6_371_000
  // 度 → ラジアン
  const rad = (d: number) => (d * Math.PI) / 180
  // 緯度差・経度差（ラジアン）
  const dp = rad(b.lat - a.lat)
  const dl = rad(b.lng - a.lng)
  // ハーバーサインの式
  const h = Math.sin(dp / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dl / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(h))
}

/**
 * エリア（現在地からの半径、または都道府県・市区町村）で絞り込む。
 * 現在地を使うときは、各店舗に現在地からの距離（distance）を付ける。
 * @param list お気に入りの店舗
 * @param f 絞り込み条件
 * @returns エリア内の店舗
 */
export function filterByArea(list: Restaurant[], f: FavoriteFilters): Restaurant[] {
  const here = f.currentLocation
  if (here) {
    // 座標のある店舗に距離を付け、半径以内だけを残す
    return list.flatMap((r) => {
      if (r.lat == null || r.lng == null) return []
      const distance = distanceM(here, { lat: r.lat, lng: r.lng })
      return distance <= f.radiusKm * 1000 ? [{ ...r, distance }] : []
    })
  }
  // 都道府県・市区町村が「すべて」以外なら一致するものだけ
  return list.filter(
    (r) =>
      (f.prefecture === ALL_AREAS || r.prefecture === f.prefecture) &&
      (f.area === ALL_AREAS || r.area === f.area),
  )
}

/**
 * エリア以外の条件（ジャンル・評価・予算・設備）に合うか。
 * @param r 店舗
 * @param f 絞り込み条件
 * @returns すべての条件に合えば true
 */
export function matchesConditions(r: Restaurant, f: FavoriteFilters): boolean {
  const [minRating, maxRating] = f.rating
  const [minBudget, maxBudget] = f.budget
  return (
    // ジャンル：指定がなければ通す。指定があれば、いずれかのカテゴリを持てば通す
    (f.genres.length === 0 || r.categories.some((c) => f.genres.includes(c.alias))) &&
    // 評価：範囲内
    minRating <= r.rating &&
    r.rating <= maxRating &&
    // 予算：下限以上、かつ上限が最大でなければ上限以下
    r.budget >= minBudget &&
    (maxBudget >= BUDGET_MAX || r.budget <= maxBudget) &&
    // 設備：指定したときは「あり」と分かっている店だけ
    (!f.parking || r.parking === true) &&
    (!f.groups || r.good_for_groups === true)
  )
}

/**
 * 店舗のカテゴリを集計し、件数の多い順（同数なら名前順）に並べる（ジャンルの選択肢用）。
 * @param list 集計する店舗
 * @returns ジャンルの選択肢
 */
export function genreFacets(list: Restaurant[]): GenreFacet[] {
  // alias → 選択肢
  const facets = new Map<string, GenreFacet>()
  for (const r of list) {
    for (const c of r.categories) {
      // 初出なら件数 0 で登録し、件数を 1 増やす
      const f = facets.get(c.alias) ?? { ...c, count: 0 }
      f.count += 1
      facets.set(c.alias, f)
    }
  }
  return [...facets.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "ja"))
}

/** エリアの選択肢（都道府県ごとの件数と市区町村） */
export interface AreaOption {
  /** 都道府県名 */
  prefecture: string
  /** その都道府県のお気に入りの件数 */
  count: number
  /** 市区町村と件数（名前順） */
  cities: { name: string; count: number }[]
}

/**
 * お気に入りに含まれる都道府県・市区町村から、エリアの選択肢を作る。
 * 都道府県は北から（PREFECTURES の順）、市区町村は名前順に並べる。都道府県が分からない店舗は含めない。
 * @param list お気に入りの店舗
 * @returns エリアの選択肢
 */
export function areaOptions(list: Restaurant[]): AreaOption[] {
  // 都道府県名 → (件数, 市区町村名 → 件数)
  const byPref = new Map<string, { count: number; cities: Map<string, number> }>()
  for (const r of list) {
    if (!r.prefecture) continue
    const p = byPref.get(r.prefecture) ?? { count: 0, cities: new Map<string, number>() }
    p.count += 1
    if (r.area) p.cities.set(r.area, (p.cities.get(r.area) ?? 0) + 1)
    byPref.set(r.prefecture, p)
  }
  // 都道府県の並び順（一覧にない名前は最後）
  const order = (name: string) => {
    const i = PREFECTURES.findIndex((p) => p.name === name)
    return i === -1 ? PREFECTURES.length : i
  }
  return [...byPref.entries()]
    .sort(([a], [b]) => order(a) - order(b))
    .map(([prefecture, p]) => ({
      prefecture,
      count: p.count,
      cities: [...p.cities.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name, "ja")),
    }))
}

/** お気に入りの並び順のキー */
export type FavoriteSortKey = "added" | "name" | "priceAsc" | "priceDesc" | "rating"

/** お気に入りの並び順の選択肢 */
export const FAVORITE_SORT_OPTIONS: { value: FavoriteSortKey; label: string }[] = [
  { value: "added", label: "登録の新しい順" },
  { value: "name", label: "名前順" },
  { value: "priceAsc", label: "価格の安い順" },
  { value: "priceDesc", label: "価格の高い順" },
  { value: "rating", label: "評価の高い順" },
]

/**
 * お気に入りを並び替える（新しい配列を返す）。同じ値の店舗は登録の新しい順のまま。
 * @param list 登録の新しい順に並んだ店舗（変更しない）
 * @param key 並び順のキー
 * @returns 並び替えた新しい配列
 */
export function sortFavorites(list: Restaurant[], key: FavoriteSortKey): Restaurant[] {
  // 元の配列を壊さないようにコピーする（sort は安定ソートなので、同じ値は元の順が保たれる）
  const sorted = [...list]
  switch (key) {
    case "name":
      // 名前の五十音・アルファベット順
      return sorted.sort((a, b) => a.name.localeCompare(b.name, "ja"))
    case "priceAsc":
      // 予算の安い順
      return sorted.sort((a, b) => a.budget - b.budget)
    case "priceDesc":
      // 予算の高い順
      return sorted.sort((a, b) => b.budget - a.budget)
    case "rating":
      // 評価の高い順。同点ならレビュー数の多い順
      return sorted.sort((a, b) => b.rating - a.rating || b.review_count - a.review_count)
    default:
      // 登録の新しい順（受け取った順のまま）
      return sorted
  }
}
