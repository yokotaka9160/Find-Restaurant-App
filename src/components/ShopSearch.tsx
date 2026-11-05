// 遅延読み込み(lazy/Suspense)・副作用・メモ化・参照保持・状態管理の React フックを読み込む
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
// 画面で使う lucide-react のアイコンを読み込む
import {
  ChevronLeft, // 戻る矢印
  ImageOff, // 画像なし
  LayoutGrid, // リスト表示
  Loader2, // 読み込み中
  LocateFixed, // 現在地
  Map as MapIcon, // マップ表示（組み込みの Map と名前が衝突しないよう別名）
  MapPin, // 地図ピン
  RotateCcw, // リセット
  Route, // ルート
  SearchX, // 該当なし
  SlidersHorizontal, // 絞り込み
  Star, // 評価の星
  UtensilsCrossed, // ロゴ（フォークとナイフ）
  X, // 閉じる
} from "lucide-react"

// バッジ部品
import { Badge } from "@/components/ui/badge"
// ボタン部品
import { Button } from "@/components/ui/button"
// カード部品一式
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
// チェックボックス部品
import { Checkbox } from "@/components/ui/checkbox"
// ラベル部品
import { Label } from "@/components/ui/label"
// セレクトボックス部品一式
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
// スライダー部品
import { Slider } from "@/components/ui/slider"
// ルート検索の入力欄
import RouteSearchFields from "@/components/RouteSearchFields"
// 地方・都道府県データと、市区町村一覧を返す関数
import { REGIONS, citiesOf } from "@/data/areas"
// 現在地を取得するフック
import { useGeolocation } from "@/hooks/useGeolocation"
// 検索条件の定数・API 関数・整形関数・型
import {
  ALL_AREAS,
  ApiError,
  BUDGET_MAX,
  BUDGET_MIN,
  BUDGET_STEP,
  DEFAULT_FILTERS,
  RADIUS_MAX_KM,
  RADIUS_MIN_KM,
  RATING_MAX,
  RATING_MIN,
  SORT_OPTIONS,
  fetchShops,
  formatDistance,
  formatDuration,
  formatYen,
  isRouteReady,
  sortRestaurants,
  type GenreFacet,
  type Restaurant,
  type RouteInfo,
  type SearchFilters,
  type ShopsResponse,
  type SortKey,
} from "@/data/restaurants"

// 地図（Leaflet）は地図表示に切り替えたときだけ読み込む
const ShopMap = lazy(() => import("@/components/ShopMap"))

/** ジャンルの選択肢を最初に表示する数（残りは「もっと見る」） */
const GENRE_PREVIEW_COUNT = 12

/* ------------------------------------------------------------------ */
/* 画面本体：検索条件を useState で保持し、変更のたびに FastAPI から再取得する */
/* ------------------------------------------------------------------ */

/**
 * 飲食店検索画面の本体。
 * @param onHome ホームへ戻るときに呼ばれる関数（省略時は戻るボタンを出さない）
 * @returns 検索画面の JSX
 */
export default function RestaurantSearch({ onHome }: { onHome?: () => void }) {
  // 検索条件
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS)
  // 並び順
  const [sortKey, setSortKey] = useState<SortKey>("recommended")
  // 絞り込みパネルを開いているか
  const [filtersOpen, setFiltersOpen] = useState(false) // モバイルのみ使用
  // 表示形式（リスト or マップ）
  const [view, setView] = useState<"list" | "map">("list")

  // API から取得した店舗一覧
  const [shops, setShops] = useState<Restaurant[]>([])
  // 絞り込み前の総件数
  const [total, setTotal] = useState(0)
  // ジャンルの選択肢（件数付き）
  const [genreFacets, setGenreFacets] = useState<GenreFacet[]>([])
  // データの取得元（yelp / mock）。未取得なら null
  const [source, setSource] = useState<ShopsResponse["source"] | null>(null)
  // これまでに見たジャンルの表示名（エリアを変えて選択肢から消えた選択中ジャンルの表示用）
  const genreTitles = useRef(new Map<string, string>())
  // ルート検索のルート情報
  const [route, setRoute] = useState<RouteInfo | null>(null)
  // 取得状態（読み込み中・完了・エラー）
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  // API が返したエラーメッセージ
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // 再読み込みボタンを押した回数（変えると再取得が走る）
  const [retryCount, setRetryCount] = useState(0)

  // ルート検索モードかどうか
  const routeMode = filters.mode === "route"
  // ルート検索で出発地・目的地がそろっていない
  const routePending = routeMode && !isRouteReady(filters)

  // 検索条件が変わるたびに API を呼ぶ。
  // - スライダー操作中の連続リクエストを避けるため 250ms デバウンス
  // - 古いリクエストは AbortController で破棄（レスポンスの追い越し対策）
  useEffect(() => {
    // ルート検索の条件がそろっていなければ、結果を空にして API は呼ばない
    if (routePending) {
      setShops([])
      setTotal(0)
      setGenreFacets([])
      setRoute(null)
      setStatus("ready")
      return
    }
    // このリクエストを中断するためのコントローラ
    const controller = new AbortController()
    // 読み込み中にする
    setStatus("loading")
    // 250ms 待ってからリクエストする（その間に条件が変わればキャンセルされる）
    const timer = window.setTimeout(() => {
      fetchShops(filters, controller.signal)
        // 成功時：結果を各状態に反映する
        .then((data) => {
          setShops(data.items)
          setTotal(data.total)
          // ジャンルの alias → 表示名 を覚えておく
          data.genres.forEach((g) => genreTitles.current.set(g.alias, g.title))
          setGenreFacets(data.genres)
          setSource(data.source)
          // ルート情報がなければ null
          setRoute(data.route ?? null)
          setStatus("ready")
        })
        // 失敗時
        .catch((err) => {
          // 自分で中断したリクエストはエラー扱いしない
          if (err instanceof DOMException && err.name === "AbortError") return
          // API のエラーならそのメッセージを、それ以外は null（既定の文言を出す）
          setErrorMessage(err instanceof ApiError ? err.message : null)
          setStatus("error")
        })
    }, 250)
    // 条件が変わった／アンマウント時：待機中のタイマーと実行中のリクエストを取り消す
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [filters, retryCount, routePending])

  // ルート検索ではルート順を既定にし、ルート検索をやめたら「ルート順」を解除する
  useEffect(() => {
    setSortKey((k) => (routeMode ? "route" : k === "route" ? "recommended" : k))
  }, [routeMode])

  // 出発地・目的地がそろったらルートが見えるよう地図表示に切り替える
  const routeReady = isRouteReady(filters)
  useEffect(() => {
    if (routeReady) setView("map")
  }, [routeReady])

  // 並び替えはクライアント側で実施
  const results = useMemo(() => sortRestaurants(shops, sortKey), [shops, sortKey])
  // 並び順の選択肢（「ルート順」はルート検索時のみ）
  const sortOptions = SORT_OPTIONS.filter((o) => routeMode || !o.routeOnly)

  // ジャンルの選択肢 = API が返したカテゴリ ＋ 選択中だが今のエリアには無いカテゴリ（0件）
  const genreOptions = useMemo<GenreFacet[]>(() => {
    // 選択中なのに API の選択肢に無いジャンルを、件数 0 の選択肢として作る
    const missing = filters.genres
      .filter((alias) => !genreFacets.some((g) => g.alias === alias))
      .map((alias) => ({ alias, title: genreTitles.current.get(alias) ?? alias, count: 0 }))
    // 選択中で消えたものを先頭に置く
    return [...missing, ...genreFacets]
  }, [genreFacets, filters.genres])

  /**
   * 検索条件の 1 項目を更新する。
   * @param key 更新する項目名
   * @param value 新しい値
   * @returns なし
   */
  const update = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }))

  // 検索条件が初期値のままか（リセットボタンの無効化に使う）
  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_FILTERS)
  /** 検索条件を初期値に戻す（引数・返り値なし） */
  const reset = () => setFilters(DEFAULT_FILTERS)

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      {/* 上部の固定ヘッダー */}
      <Header onHome={onHome} />

      {/* 本文：PC では左に条件パネル（300px）、右に結果の 2 列 */}
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[300px_1fr] lg:items-start lg:px-8">
        {/* モバイル：フィルタ開閉ボタン */}
        <Button
          variant="outline"
          className="w-full justify-between lg:hidden"
          aria-expanded={filtersOpen}
          aria-controls="filter-panel"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal /> 絞り込み条件
          </span>
          {/* 開閉状態に応じた文言 */}
          <span className="text-xs text-muted-foreground">
            {filtersOpen ? "閉じる" : "開く"}
          </span>
        </Button>

        {/* 条件パネルの外枠：モバイルは開閉、PC は常に表示してスクロールに追従 */}
        <div
          id="filter-panel"
          className={`${filtersOpen ? "block" : "hidden"} lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain`}
        >
          {/* 検索条件パネル */}
          <FilterPanel
            filters={filters}
            genreOptions={genreOptions}
            onChange={update}
            onReset={reset}
            resetDisabled={isDefault}
          />
        </div>

        {/* 検索結果エリア */}
        <section aria-label="検索結果" className="min-w-0">
          {/* ルート検索中は「出発地 → 目的地」と距離・所要時間を表示する */}
          {routeMode && filters.origin && filters.destination && (
            <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-background px-3 py-2 text-sm">
              <Route className="size-4 text-primary" />
              <span className="font-medium">{filters.origin.label}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-medium">{filters.destination.label}</span>
              {/* ルート取得済みなら距離・所要時間・検索幅を表示 */}
              {route && (
                <span className="text-muted-foreground tabular-nums">
                  ｜{formatDistance(route.distance_m)}・車で約{formatDuration(route.duration_s)}
                  ｜ルートから{formatDistance(filters.routeBufferM)}以内
                </span>
              )}
            </div>
          )}
          {/* 件数と表示切り替え・並び替えの行 */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {/* 件数（変化をスクリーンリーダーに通知） */}
            <p className="flex items-center gap-1 text-sm" aria-live="polite">
              <span className="text-2xl font-bold tabular-nums">{results.length}</span>
              <span className="ml-1 text-muted-foreground">
                件のお店（全{total}件中）
              </span>
              {/* 読み込み中はくるくるアイコン */}
              {status === "loading" && (
                <Loader2 className="ml-2 size-4 animate-spin text-muted-foreground" />
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {/* リスト／マップの切り替えボタン */}
              <div
                className="flex rounded-md border bg-background p-0.5"
                role="group"
                aria-label="表示切り替え"
              >
                <Button
                  variant={view === "list" ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                >
                  <LayoutGrid /> リスト
                </Button>
                <Button
                  variant={view === "map" ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={view === "map"}
                  onClick={() => setView("map")}
                >
                  <MapIcon /> マップ
                </Button>
              </div>
              {/* リスト表示のときだけ並び替えを出す */}
              {view === "list" && (
                <>
                  {/* 画面には出さず読み上げ用のラベル */}
                  <Label htmlFor="sort" className="sr-only">
                    並び替え
                  </Label>
                  <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                    <SelectTrigger id="sort" className="w-40 bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* 並び順の選択肢 */}
                      {sortOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
          </div>

          {/* 状態に応じて表示する中身を切り替える */}
          {routePending ? (
            // ルート検索の入力待ち
            <RoutePendingState />
          ) : status === "error" ? (
            // エラー（再読み込みで retryCount を増やして再取得）
            <ErrorState message={errorMessage} onRetry={() => setRetryCount((c) => c + 1)} />
          ) : status === "loading" && shops.length === 0 ? (
            // 初回の読み込み中（前回結果がない）
            <p className="py-16 text-center text-sm text-muted-foreground">
              {routeMode ? "ルートとお店を検索中…" : "読み込み中…"}
            </p>
          ) : view === "map" && (results.length > 0 || route) ? (
            // マップ表示（店舗かルートがあるとき）。再取得中は半透明
            <div className={`transition-opacity ${status === "loading" ? "opacity-60" : ""}`}>
              {/* 地図コンポーネントの読み込み中は代わりの文言を出す */}
              <Suspense
                fallback={
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    地図を読み込み中…
                  </p>
                }
              >
                {/* ルート関連はルート検索時のみ、現在地はエリア検索時のみ渡す */}
                <ShopMap
                  restaurants={results}
                  currentLocation={routeMode ? null : filters.currentLocation}
                  radiusKm={filters.radiusKm}
                  route={routeMode ? route : null}
                  origin={routeMode ? filters.origin : null}
                  destination={routeMode ? filters.destination : null}
                />
              </Suspense>
              {/* ルートはあるが店舗が 0 件のときの案内 */}
              {results.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  ルート沿いに条件に合うお店がありません。ルートからの距離を広げるか、条件をゆるめてください。
                </p>
              )}
            </div>
          ) : results.length > 0 ? (
            // リスト表示（画面幅に応じて 1〜3 列）。再取得中は半透明
            <ul
              className={`grid gap-4 transition-opacity sm:grid-cols-2 xl:grid-cols-3 ${
                status === "loading" ? "opacity-60" : ""
              }`}
            >
              {/* 店舗ごとにカードを表示 */}
              {results.map((r) => (
                <li key={r.id}>
                  <RestaurantCard restaurant={r} distancePrefix={routeMode ? "ルートから" : ""} />
                </li>
              ))}
            </ul>
          ) : (
            // 該当なし
            <EmptyState onReset={reset} />
          )}

          {/* Yelp のデータなら Yelp のクレジット表記を出す */}
          {source === "yelp" && (
            <p className="mt-6 text-right text-xs text-muted-foreground">
              Powered by{" "}
              <a
                href="https://www.yelp.com"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-[#d32323] hover:underline"
              >
                Yelp
              </a>
              ｜予算は Yelp の価格帯からの目安です
            </p>
          )}
          {/* モックデータなら、その旨と切り替え方法を出す */}
          {source === "mock" && (
            <p className="mt-6 text-right text-xs text-muted-foreground">
              サンプルデータを表示中（バックエンドに YELP_API_KEY を設定すると Yelp の店舗を表示します）
            </p>
          )}
        </section>
      </main>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* ヘッダー                                                             */
/* ------------------------------------------------------------------ */

/**
 * 画面上部の固定ヘッダー（戻るボタン・ロゴ・説明文）。
 * @param onHome ホームへ戻る関数（省略時は戻るボタンを出さない）
 * @returns ヘッダーの JSX
 */
function Header({ onHome }: { onHome?: () => void }) {
  return (
    // スクロールしても上部に固定し、背景を少し透かしてぼかす
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        {/* 戻るボタン（onHome があるときだけ） */}
        {onHome && (
          <Button variant="ghost" size="icon" onClick={onHome} aria-label="ホームへ戻る">
            <ChevronLeft />
          </Button>
        )}
        {/* ロゴとアプリ名 */}
        <div className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <UtensilsCrossed className="size-4" />
          </span>
          FindRestr
        </div>
        {/* 説明文（スマホ幅では非表示） */}
        <p className="ml-auto hidden text-sm text-muted-foreground sm:block">
          エリア・ルート・予算・ジャンル・評価でお店を探す
        </p>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ */
/* 検索条件パネル                                                       */
/* ------------------------------------------------------------------ */

/** FilterPanel の引数（props） */
interface FilterPanelProps {
  /** 現在の検索条件 */
  filters: SearchFilters
  /** ジャンルの選択肢（API の返り値から作る） */
  genreOptions: GenreFacet[]
  /** 条件の 1 項目を変更する関数 */
  onChange: <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => void
  /** 条件をリセットする関数 */
  onReset: () => void
  /** リセットボタンを無効にするか */
  resetDisabled: boolean
}

/**
 * 検索条件パネル（検索方法・エリア/ルート・予算・ジャンル・評価）。
 * @param props FilterPanelProps を参照
 * @returns パネルの JSX
 */
function FilterPanel({
  filters,
  genreOptions,
  onChange,
  onReset,
  resetDisabled,
}: FilterPanelProps) {
  // 予算の下限・上限
  const [minB, maxB] = filters.budget
  // 評価の下限・上限
  const [minR, maxR] = filters.rating
  // 現在地取得フック
  const geo = useGeolocation()

  /**
   * 都道府県を変更する（市区町村は「全域」に戻す）。
   * @param prefecture 新しい都道府県名
   * @returns なし
   */
  const changePrefecture = (prefecture: string) => {
    onChange("prefecture", prefecture)
    onChange("area", ALL_AREAS)
  }

  // ジャンルをすべて表示するか
  const [showAllGenres, setShowAllGenres] = useState(false)
  // 表示するジャンル（すべて or 先頭 GENRE_PREVIEW_COUNT 件）
  const visibleGenres = showAllGenres
    ? genreOptions
    : genreOptions.slice(0, GENRE_PREVIEW_COUNT)

  /**
   * ジャンルの選択を切り替える。
   * @param alias ジャンルの ID
   * @param checked チェックされたら true
   * @returns なし
   */
  const toggleGenre = (alias: string, checked: boolean) =>
    onChange(
      "genres",
      // チェックなら追加、外したら取り除く
      checked ? [...filters.genres, alias] : filters.genres.filter((g) => g !== alias),
    )

  return (
    <Card className="gap-5 py-5">
      {/* 見出しとリセットボタン */}
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="text-base">検索条件</CardTitle>
        <Button variant="ghost" size="sm" onClick={onReset} disabled={resetDisabled}>
          <RotateCcw /> リセット
        </Button>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* 検索方法の切り替え */}
        <div className="grid grid-cols-2 rounded-md border bg-muted/50 p-0.5" role="tablist">
          {/* [モード, 表示名, アイコン] の組からタブを作る */}
          {(
            [
              ["area", "エリアで探す", MapPin],
              ["route", "ルートで探す", Route],
            ] as const
          ).map(([mode, label, Icon]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={filters.mode === mode}
              onClick={() => onChange("mode", mode)}
              // 選択中のタブは白背景・太字で強調する
              className={`flex items-center justify-center gap-1.5 rounded-[5px] px-2 py-1.5 text-sm transition-colors ${
                filters.mode === mode
                  ? "bg-background font-medium text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        {filters.mode === "route" ? (
          /* ルート：出発地・目的地・ルートからの距離 */
          <RouteSearchFields
            origin={filters.origin}
            destination={filters.destination}
            bufferM={filters.routeBufferM}
            onOriginChange={(p) => onChange("origin", p)}
            onDestinationChange={(p) => onChange("destination", p)}
            onBufferChange={(m) => onChange("routeBufferM", m)}
          />
        ) : (
          /* エリア：現在地 or 都道府県 → 市区町村 */
          <div className="space-y-2">
            <Label htmlFor="prefecture">エリア</Label>
            {filters.currentLocation ? (
              // 現在地で検索中：半径の表示・解除ボタン・半径スライダー
              <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <LocateFixed className="size-4 text-primary" />
                    現在地から
                    <span className="font-medium tabular-nums text-primary">
                      {filters.radiusKm}km
                    </span>
                    以内
                  </span>
                  {/* 現在地検索を解除して都道府県選択に戻す */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label="現在地での検索を解除"
                    onClick={() => onChange("currentLocation", null)}
                  >
                    <X />
                  </Button>
                </div>
                {/* 半径（km）のスライダー */}
                <Slider
                  min={RADIUS_MIN_KM}
                  max={RADIUS_MAX_KM}
                  step={1}
                  value={[filters.radiusKm]}
                  thumbLabels={["現在地からの距離（km）"]}
                  onValueChange={(v) => onChange("radiusKm", v[0])}
                />
                {/* スライダーの両端の目盛り */}
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{RADIUS_MIN_KM}km</span>
                  <span>{RADIUS_MAX_KM}km</span>
                </div>
              </div>
            ) : (
              <>
                {/* 都道府県の選択（地方ごとにグループ表示） */}
                <Select value={filters.prefecture} onValueChange={changePrefecture}>
                  <SelectTrigger id="prefecture" className="bg-background">
                    <MapPin className="text-muted-foreground" />
                    <SelectValue placeholder="都道府県を選択" />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    {REGIONS.map((region) => (
                      <SelectGroup key={region.name}>
                        {/* 地方名の見出し */}
                        <SelectLabel>{region.name}</SelectLabel>
                        {/* その地方の都道府県 */}
                        {region.prefectures.map((p) => (
                          <SelectItem key={p.name} value={p.name}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                {/* 市区町村の選択 */}
                <Select value={filters.area} onValueChange={(v) => onChange("area", v)}>
                  <SelectTrigger aria-label="市区町村" className="bg-background">
                    <SelectValue placeholder="市区町村を選択" />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    {/* 都道府県全域 */}
                    <SelectItem value={ALL_AREAS}>{filters.prefecture}全域</SelectItem>
                    {/* 選択中の都道府県の市区町村 */}
                    {citiesOf(filters.prefecture).map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
            {/* 現在地を使っていなければ「現在地から探す」ボタンを出す */}
            {!filters.currentLocation && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                // 取得できたら現在地を検索条件に入れる
                onClick={() => geo.locate((p) => onChange("currentLocation", p))}
                disabled={geo.locating}
              >
                {geo.locating ? <Loader2 className="animate-spin" /> : <LocateFixed />}
                {geo.locating ? "現在地を取得中…" : "現在地から探す"}
              </Button>
            )}
            {/* 現在地取得のエラー */}
            {geo.error && (
              <p className="text-xs text-destructive" role="alert">
                {geo.error}
              </p>
            )}
          </div>
        )}

        {/* 予算 */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label>予算（1人あたり）</Label>
            {/* 選択中の範囲。上限が最大なら「◯円以上」 */}
            <span className="text-sm font-medium tabular-nums text-primary">
              {formatYen(minB)} 〜 {maxB >= BUDGET_MAX ? `${formatYen(BUDGET_MAX)}以上` : formatYen(maxB)}
            </span>
          </div>
          {/* 下限・上限の 2 つのつまみを持つスライダー（つまみ同士は 1 目盛り以上離す） */}
          <Slider
            min={BUDGET_MIN}
            max={BUDGET_MAX}
            step={BUDGET_STEP}
            minStepsBetweenThumbs={1}
            value={filters.budget}
            thumbLabels={["予算の下限", "予算の上限"]}
            onValueChange={(v) => onChange("budget", [v[0], v[1]])}
          />
        </div>

        {/* ジャンル */}
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm leading-none font-medium">
            ジャンル
            {/* 選択数（0 件なら「すべて」） */}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {filters.genres.length === 0 ? "すべて" : `${filters.genres.length}件選択`}
            </span>
          </legend>
          {genreOptions.length === 0 ? (
            // 選択肢がないとき
            <p className="text-xs text-muted-foreground">このエリアのジャンルはまだありません</p>
          ) : (
            // 2 列でチェックボックスを並べる
            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
              {visibleGenres.map((g) => (
                <div key={g.alias} className="flex min-w-0 items-center gap-2">
                  {/* 選択中なら checked。c は true/false/"indeterminate" なので true のみ選択扱い */}
                  <Checkbox
                    id={`genre-${g.alias}`}
                    checked={filters.genres.includes(g.alias)}
                    onCheckedChange={(c) => toggleGenre(g.alias, c === true)}
                  />
                  {/* ジャンル名と件数（クリックでもチェック切り替え） */}
                  <Label
                    htmlFor={`genre-${g.alias}`}
                    className="min-w-0 cursor-pointer font-normal"
                    title={g.title}
                  >
                    <span className="truncate">{g.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {g.count}
                    </span>
                  </Label>
                </div>
              ))}
            </div>
          )}
          {/* 選択肢が多いときは「もっと見る／閉じる」ボタンを出す */}
          {genreOptions.length > GENRE_PREVIEW_COUNT && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setShowAllGenres((v) => !v)}
            >
              {showAllGenres
                ? "閉じる"
                : `もっと見る（残り${genreOptions.length - GENRE_PREVIEW_COUNT}件）`}
            </Button>
          )}
        </fieldset>

        {/* 評価 */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label>評価</Label>
            {/* 初期値のままなら「指定なし」、それ以外は星と範囲 */}
            <span className="flex items-center gap-1 text-sm font-medium tabular-nums text-primary">
              {minR === RATING_MIN && maxR === RATING_MAX ? (
                "指定なし"
              ) : (
                <>
                  <Star className="size-3.5 fill-amber-400 text-amber-400" />
                  {minR.toFixed(1)} 〜 {maxR.toFixed(1)}
                </>
              )}
            </span>
          </div>
          {/* 評価の下限・上限スライダー（0.5 刻み） */}
          <Slider
            min={RATING_MIN}
            max={RATING_MAX}
            step={0.5}
            value={filters.rating}
            thumbLabels={["評価の下限", "評価の上限"]}
            onValueChange={(v) => onChange("rating", [v[0], v[1]])}
          />
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* 店舗カード                                                           */
/* ------------------------------------------------------------------ */

/**
 * 店舗 1 件ぶんのカード（画像・ジャンル・店名・場所・説明・評価・リンク）。
 * @param restaurant 表示する店舗
 * @param distancePrefix 距離の前に付ける説明
 * @returns カードの JSX
 */
function RestaurantCard({
  restaurant: r,
  distancePrefix = "",
}: {
  restaurant: Restaurant
  /** 距離の前に付ける説明（ルート検索なら「ルートから」） */
  distancePrefix?: string
}) {
  // 画像を表示できないか（画像 URL が空なら最初から true）
  const [imageFailed, setImageFailed] = useState(!r.image)

  return (
    <Card className="h-full gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md">
      {/* 画像エリア（16:10） */}
      <div className="relative aspect-[16/10] bg-muted">
        {imageFailed ? (
          // 画像なしアイコン
          <div className="grid h-full place-items-center text-muted-foreground">
            <ImageOff />
          </div>
        ) : (
          // 店舗画像（画面に近づいてから読み込む。失敗したら画像なし表示へ）
          <img
            src={r.image}
            alt={`${r.name}の料理・店内`}
            loading="lazy"
            className="size-full object-cover"
            onError={() => setImageFailed(true)}
          />
        )}
        {/* 左上のジャンルバッジ */}
        <Badge className="absolute top-3 left-3 bg-background/90 text-foreground backdrop-blur">
          {r.genre}
        </Badge>
      </div>

      <CardContent className="flex flex-1 flex-col gap-2 p-4">
        {/* 店名 */}
        <h3 className="leading-snug font-semibold">{r.name}</h3>
        {/* 場所・距離・平均予算 */}
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3.5" />
          {/* 都道府県と市区町村のうち空でないものをつなぐ（どちらも空なら「—」） */}
          {[r.prefecture, r.area].filter(Boolean).join(" ") || "—"}
          {/* 距離があれば表示 */}
          {r.distance != null && `（${distancePrefix}${formatDistance(r.distance)}）`}
          ｜平均 {formatYen(r.budget)}
        </p>
        {/* 説明文（2 行で省略） */}
        <p className="line-clamp-2 text-sm text-muted-foreground">{r.description}</p>

        {/* カード下部：評価とリンク */}
        <div className="mt-auto flex items-center justify-between pt-3">
          <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
            <Star className="size-4 fill-amber-400 text-amber-400" />
            {r.rating.toFixed(1)}
            {/* レビュー件数（3 桁区切り） */}
            <span className="text-xs font-normal text-muted-foreground">
              ({r.review_count.toLocaleString("ja-JP")})
            </span>
          </span>
          {/* Yelp ページがあればリンクボタン（新しいタブ） */}
          {r.url && (
            <Button variant="outline" size="sm" asChild>
              <a href={r.url} target="_blank" rel="noreferrer">
                Yelpで見る
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* 該当なし                                                             */
/* ------------------------------------------------------------------ */

/**
 * 検索結果が 0 件のときの表示。
 * @param onReset 条件をリセットする関数
 * @returns 該当なし表示の JSX
 */
function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <Card className="items-center gap-3 border-dashed py-16 text-center">
      <SearchX className="size-10 text-muted-foreground" />
      <p className="font-semibold">条件に合うお店が見つかりませんでした</p>
      <p className="text-sm text-muted-foreground">
        予算の範囲を広げるか、評価・ジャンルの条件をゆるめてみてください。
      </p>
      {/* 押すと条件を初期値に戻す */}
      <Button variant="outline" onClick={onReset}>
        <RotateCcw /> 条件をリセット
      </Button>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* ルート検索：出発地・目的地の入力待ち                                    */
/* ------------------------------------------------------------------ */

/**
 * ルート検索で出発地・目的地がそろっていないときの案内。
 * @returns 案内表示の JSX（引数なし）
 */
function RoutePendingState() {
  return (
    <Card className="items-center gap-3 border-dashed py-16 text-center">
      <Route className="size-10 text-muted-foreground" />
      <p className="font-semibold">出発地と目的地を指定してください</p>
      <p className="px-4 text-sm text-muted-foreground">
        左の検索条件で駅名・住所などを検索して選ぶと、ルート沿いのお店を探します。
        出発地には現在地も使えます。
      </p>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* API エラー                                                           */
/* ------------------------------------------------------------------ */

/**
 * 店舗データの取得に失敗したときの表示。
 * @param message バックエンドが返したエラーメッセージ（なければ null）
 * @param onRetry 再読み込みする関数
 * @returns エラー表示の JSX
 */
function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <Card className="items-center gap-3 border-dashed py-16 text-center" role="alert">
      <SearchX className="size-10 text-muted-foreground" />
      <p className="font-semibold">店舗データを取得できませんでした</p>
      <p className="px-4 text-sm text-muted-foreground">
        {/* バックエンドが理由を返したとき（ルートが見つからない等）はそれを表示する */}
        {message ??
          "バックエンド（http://localhost:8000）が起動しているか、YELP_API_KEY が正しいか確認してください。"}
      </p>
      {/* 押すと再取得する */}
      <Button variant="outline" onClick={onRetry}>
        <RotateCcw /> 再読み込み
      </Button>
    </Card>
  )
}
