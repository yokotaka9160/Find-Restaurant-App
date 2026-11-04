/**
 * 飲食店の型・検索条件・API クライアント。
 *
 * 店舗データは FastAPI（backend/main.py）の `GET /api/shops` から取得します。
 * バックエンドが Yelp Fusion API を呼び出します（API キーをブラウザに出さないため）。
 * 型は backend の Pydantic モデル `Shop` と 1:1 です。
 */

// 初期表示の都道府県を読み込む（DEFAULT_FILTERS で使う）
import { DEFAULT_PREFECTURE } from "@/data/areas"

/** Yelp のカテゴリ */
export interface Category {
  /** カテゴリ ID（例: sushi）。ジャンル検索の値に使う */
  alias: string
  /** 日本語の表示名（例: 寿司）。バックエンドで対訳がないカテゴリは Yelp の英語名 */
  title: string
}

/** ジャンルの選択肢（エリア内の店舗のカテゴリを集計したもの） */
export interface GenreFacet extends Category {
  /** そのジャンルに該当する店舗数 */
  count: number
}

/** 飲食店 1 件 */
export interface Restaurant {
  /** Yelp の business id（モック時は連番の文字列） */
  id: string
  /** 店名 */
  name: string
  /** 都道府県。現在地検索の Yelp 結果では空文字 */
  prefecture: string
  /** 市区町村・エリア名（Yelp の場合は店舗住所の city） */
  area: string
  /** 現在地検索では現在地から、ルート検索ではルートからの距離（m） */
  distance?: number | null
  /** ルート検索のみ：出発地からの道のり（m） */
  along?: number | null
  /** 緯度・経度（地図表示用）。Yelp に座標がない店舗は null */
  lat?: number | null
  lng?: number | null
  /** 代表ジャンル（categories の先頭の title） */
  genre: string
  /** 店舗のカテゴリ一覧 */
  categories: Category[]
  /** 1人あたりの平均予算（円）。Yelp の場合は価格帯（$〜$$$$）からの目安 */
  budget: number
  /** 評価（1.0〜5.0） */
  rating: number
  /** レビュー件数 */
  review_count: number
  /** 店舗の説明文 */
  description: string
  /** 画像 URL。Yelp に画像がない店舗は空文字 */
  image: string
  /** Yelp の店舗ページ */
  url?: string | null
}

/* ------------------------------------------------------------------ */
/* 検索条件                                                            */
/* ------------------------------------------------------------------ */

/** エリア選択で「都道府県全体」を表す値 */
export const ALL_AREAS = "all"
/** 予算スライダーの下限（円） */
export const BUDGET_MIN = 0
/** スライダー上限。上限をここに置いたときは「上限なし」として扱う */
export const BUDGET_MAX = 20000
/** 予算スライダーの刻み幅（円） */
export const BUDGET_STEP = 500
/** 評価の下限 */
export const RATING_MIN = 0
/** 評価の上限 */
export const RATING_MAX = 5
/** 現在地検索の半径（km）の範囲。backend の radius（m）の上下限と合わせる */
export const RADIUS_MIN_KM = 1
export const RADIUS_MAX_KM = 5

/** ルート検索：ルートからの距離（m）の選択肢。backend の buffer（100〜2000）の範囲内 */
export const ROUTE_BUFFER_OPTIONS = [200, 500, 1000, 2000] as const
/** ルートからの距離（m）の初期値 */
export const DEFAULT_ROUTE_BUFFER_M = 500

/** 緯度・経度の座標 */
export interface GeoPoint {
  /** 緯度 */
  lat: number
  /** 経度 */
  lng: number
}

/** ルートの出発地・目的地 */
export interface RoutePoint extends GeoPoint {
  /** 表示名（地名検索の結果名、または「現在地」） */
  label: string
}

/** 検索方法：エリア検索（"area"）かルート検索（"route"）か */
export type SearchMode = "area" | "route"

/** 画面で指定する検索条件一式 */
export interface SearchFilters {
  /** 検索方法：エリア（都道府県・市区町村・現在地周辺）か、ルート沿いか */
  mode: SearchMode
  /** ルート検索の出発地・目的地。どちらも決まったら検索する */
  origin: RoutePoint | null
  destination: RoutePoint | null
  /** ルート検索：ルートからの距離（m） */
  routeBufferM: number
  /** 都道府県名 */
  prefecture: string
  /** 市区町村・エリア名。ALL_AREAS のときは都道府県全体 */
  area: string
  /** 現在地。設定されているときは prefecture / area より優先して周辺を検索する */
  currentLocation: GeoPoint | null
  /** 現在地検索の半径（km） */
  radiusKm: number
  /** 1人あたり予算の範囲 [下限, 上限]（円） */
  budget: [number, number]
  /** 選択ジャンル（Category.alias）。空配列は「指定なし（すべて）」 */
  genres: string[]
  /** 評価の範囲 [下限, 上限]。[0, 5] は「指定なし」 */
  rating: [number, number]
}

/** 検索条件の初期値（リセット時にもこの値に戻す） */
export const DEFAULT_FILTERS: SearchFilters = {
  mode: "area", // エリア検索から始める
  origin: null, // 出発地は未設定
  destination: null, // 目的地は未設定
  routeBufferM: DEFAULT_ROUTE_BUFFER_M, // ルートからの距離は初期値
  prefecture: DEFAULT_PREFECTURE, // 都道府県は初期値（東京都）
  area: ALL_AREAS, // 市区町村は「すべて」
  currentLocation: null, // 現在地は使わない
  radiusKm: RADIUS_MAX_KM, // 半径は最大
  budget: [BUDGET_MIN, BUDGET_MAX], // 予算は指定なし
  genres: [], // ジャンルは指定なし
  rating: [RATING_MIN, RATING_MAX], // 評価は指定なし
}

/** 並び順のキー */
export type SortKey = "recommended" | "rating" | "priceAsc" | "priceDesc" | "route"

/** 並び順の選択肢（routeOnly はルート検索時のみ表示する） */
export const SORT_OPTIONS: { value: SortKey; label: string; routeOnly?: boolean }[] = [
  { value: "recommended", label: "おすすめ順" },
  { value: "rating", label: "評価の高い順" },
  { value: "priceAsc", label: "価格の安い順" },
  { value: "priceDesc", label: "価格の高い順" },
  { value: "route", label: "ルート順", routeOnly: true },
]

/**
 * おすすめスコア：評価をレビュー数で補正（レビューが少ない店の過大評価を抑える）
 * @param r 対象の店舗
 * @returns スコア（大きいほどおすすめ）
 */
function recommendScore(r: Restaurant) {
  // 評価 × log10(レビュー数 + 10)。+10 でレビュー 0 件でも 1 倍になる
  return r.rating * Math.log10(r.review_count + 10)
}

/**
 * 並び替え（新しい配列を返す）
 * @param list 並び替える店舗の配列（変更しない）
 * @param key 並び順のキー
 * @returns 並び替えた新しい配列
 */
export function sortRestaurants(list: Restaurant[], key: SortKey): Restaurant[] {
  // 元の配列を壊さないようにコピーする
  const sorted = [...list]
  // キーごとに比較方法を切り替える
  switch (key) {
    case "rating":
      // 評価の高い順。同点ならレビュー数の多い順
      return sorted.sort((a, b) => b.rating - a.rating || b.review_count - a.review_count)
    case "priceAsc":
      // 予算の安い順
      return sorted.sort((a, b) => a.budget - b.budget)
    case "priceDesc":
      // 予算の高い順
      return sorted.sort((a, b) => b.budget - a.budget)
    case "route":
      // 出発地からの道のりが短い順（値がなければ 0 扱い）
      return sorted.sort((a, b) => (a.along ?? 0) - (b.along ?? 0))
    default:
      // おすすめスコアの高い順
      return sorted.sort((a, b) => recommendScore(b) - recommendScore(a))
  }
}

/**
 * 金額を「¥1,234」形式の文字列にする。
 * @param n 金額（円）
 * @returns 整形した文字列
 */
export const formatYen = (n: number) => `¥${n.toLocaleString("ja-JP")}`

/**
 * 距離を表示用の文字列にする（1km 未満は 10m 単位の m、以上は小数 1 桁の km）。
 * @param m 距離（m）
 * @returns 整形した文字列（例: 350m / 1.2km）
 */
export const formatDistance = (m: number) =>
  m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`

/**
 * 所要時間を「◯分」「◯時間◯分」形式にする。
 * @param seconds 所要時間（秒）
 * @returns 整形した文字列（最低 1 分）
 */
export function formatDuration(seconds: number): string {
  // 秒を分に丸める（0 分にならないよう最低 1 分）
  const minutes = Math.max(1, Math.round(seconds / 60))
  // 60 分未満なら「◯分」、以上なら「◯時間◯分」
  return minutes < 60 ? `${minutes}分` : `${Math.floor(minutes / 60)}時間${minutes % 60}分`
}

/**
 * ルート検索の条件がそろっているか（そろうまで API は呼ばない）
 * @param f 検索条件
 * @returns ルート検索モードで出発地・目的地がどちらも設定済みなら true
 */
export const isRouteReady = (f: SearchFilters) =>
  f.mode === "route" && f.origin !== null && f.destination !== null

/* ------------------------------------------------------------------ */
/* API クライアント                                                     */
/* ------------------------------------------------------------------ */

/** バックエンドのベース URL。環境変数 VITE_API_BASE がなければローカルの FastAPI */
export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? "http://localhost:8000"

/** /api/shops・/api/shops/route のレスポンス */
export interface ShopsResponse {
  /** 絞り込み前の総件数（Yelp の場合は Yelp 上の該当件数） */
  total: number
  /** 店舗の一覧 */
  items: Restaurant[]
  /** ジャンルの選択肢（件数の多い順） */
  genres: GenreFacet[]
  /** データの取得元。バックエンドに YELP_API_KEY が無いと "mock" */
  source: "yelp" | "mock"
  /** ルート検索のときだけ入る */
  route?: RouteInfo
}

/** ルートの形状と距離・所要時間 */
export interface RouteInfo {
  /** [lat, lng] の列 */
  coordinates: [number, number][]
  /** ルートの総距離（m） */
  distance_m: number
  /** ルートの所要時間（秒） */
  duration_s: number
}

/** 地名検索（ジオコーディング）の結果 1 件 */
export interface GeocodeResult extends GeoPoint {
  /** 地名・住所の表示名 */
  name: string
}

/** API のエラー。FastAPI の detail（日本語メッセージ）を message に入れる */
export class ApiError extends Error {}

/**
 * バックエンドに GET リクエストを送り、JSON を返す。
 * @param path API のパス（例: /api/shops）
 * @param params クエリパラメータ
 * @param signal リクエストを中断するための AbortSignal（省略可）
 * @returns レスポンスの JSON（型 T）
 * @throws ApiError ステータスが 2xx 以外のとき
 */
async function getJson<T>(path: string, params: URLSearchParams, signal?: AbortSignal): Promise<T> {
  // ベース URL・パス・クエリをつないでリクエストする
  const res = await fetch(`${API_BASE}${path}?${params}`, { signal })
  // エラーステータスの場合
  if (!res.ok) {
    // エラー本文を JSON として読む（読めなければ null）
    const body = await res.json().catch(() => null)
    // FastAPI の detail が文字列ならそれを、なければステータスコードをメッセージにして投げる
    throw new ApiError(typeof body?.detail === "string" ? body.detail : `API error: ${res.status}`)
  }
  // 成功時は JSON を返す
  return res.json()
}

/**
 * SearchFilters を FastAPI のクエリパラメータに変換して取得する（ルート検索なら /api/shops/route）
 * @param filters 検索条件
 * @param signal リクエストを中断するための AbortSignal（省略可）
 * @returns 店舗一覧・ジャンル候補などを含むレスポンス
 */
export async function fetchShops(
  filters: SearchFilters,
  signal?: AbortSignal,
): Promise<ShopsResponse> {
  // クエリパラメータを組み立てる入れ物
  const params = new URLSearchParams()
  // 出発地・目的地を取り出す
  const { origin, destination } = filters
  // ルート検索として呼ぶかどうか（モードがルートで出発地・目的地がそろっている）
  const route = filters.mode === "route" && origin !== null && destination !== null
  if (route) {
    // ルート検索：出発地・目的地の座標とルートからの距離を渡す
    params.set("olat", String(origin.lat))
    params.set("olng", String(origin.lng))
    params.set("dlat", String(destination.lat))
    params.set("dlng", String(destination.lng))
    params.set("buffer", String(filters.routeBufferM))
  } else if (filters.currentLocation) {
    // 現在地検索：現在地の座標と半径（km → m に変換）を渡す
    params.set("lat", String(filters.currentLocation.lat))
    params.set("lng", String(filters.currentLocation.lng))
    params.set("radius", String(filters.radiusKm * 1000))
  } else {
    // エリア検索：都道府県と、「すべて」以外なら市区町村を渡す
    params.set("prefecture", filters.prefecture)
    if (filters.area !== ALL_AREAS) params.set("area", filters.area)
  }
  // 選択ジャンルを genre=... として複数追加する
  filters.genres.forEach((g) => params.append("genre", g))
  // 評価の範囲を取り出し、初期値と異なる側だけパラメータにする
  const [minRating, maxRating] = filters.rating
  if (minRating > RATING_MIN) params.set("min_rating", String(minRating))
  if (maxRating < RATING_MAX) params.set("max_rating", String(maxRating))
  // 予算の範囲を取り出し、初期値と異なる側だけパラメータにする
  const [minBudget, maxBudget] = filters.budget
  if (minBudget > BUDGET_MIN) params.set("budget_min", String(minBudget))
  if (maxBudget < BUDGET_MAX) params.set("budget_max", String(maxBudget))

  // ルート検索かどうかでエンドポイントを切り替えて取得する
  return getJson(route ? "/api/shops/route" : "/api/shops", params, signal)
}

/**
 * 地名・住所・駅名から座標の候補を探す（バックエンド経由で Nominatim）
 * @param query 検索語
 * @param signal リクエストを中断するための AbortSignal（省略可）
 * @returns 座標の候補一覧
 */
export function geocode(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  // q=検索語 を付けて /api/geocode を呼ぶ
  return getJson("/api/geocode", new URLSearchParams({ q: query }), signal)
}
