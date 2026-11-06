// 副作用フック useEffect・メモ化 useMemo・状態フック useState を読み込む
import { useEffect, useMemo, useState } from "react"
// lucide-react のアイコン（戻る矢印・ハート・読み込み中・再読み込み・該当なし・絞り込み）を読み込む
import { ArrowLeft, Heart, Loader2, RotateCcw, SearchX, SlidersHorizontal } from "lucide-react"

// ボタン部品
import { Button } from "@/components/ui/button"
// カード部品
import { Card } from "@/components/ui/card"
// ラベル部品
import { Label } from "@/components/ui/label"
// セレクトボックス部品一式
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
// お気に入りの絞り込みパネル
import FavoritesFilterPanel from "@/components/FavoritesFilterPanel"
// 店舗カード
import RestaurantCard from "@/components/RestaurantCard"
// お気に入りの絞り込み・並び替え
import {
  DEFAULT_FAVORITE_FILTERS,
  FAVORITE_SORT_OPTIONS,
  areaOptions as buildAreaOptions,
  filterByArea,
  genreFacets,
  matchesConditions,
  sortFavorites,
  type FavoriteFilters,
  type FavoriteSortKey,
} from "@/data/favorites"
// API エラー型・店舗取得関数と、関連する型
import {
  ApiError,
  lookupShops,
  type GenreFacet,
  type LookupResponse,
  type Restaurant,
} from "@/data/restaurants"

/** FavoritesView の引数（props） */
interface FavoritesViewProps {
  /** お気に入りの店舗 ID（新しく登録した順） */
  ids: string[]
  /** お気に入りの登録・解除を切り替える */
  onToggle: (id: string) => void
  /** 複数の店舗をまとめてお気に入りから外す */
  onRemove: (ids: string[]) => void
  /** 検索画面に戻る */
  onBack: () => void
}

/**
 * お気に入りの一覧。開いたときに店舗 ID から最新の店舗情報を取得し、
 * ブラウザ側で絞り込み・並び替えをして表示する。
 * @param props FavoritesViewProps を参照
 * @returns 一覧画面の JSX
 */
export default function FavoritesView({ ids, onToggle, onRemove, onBack }: FavoritesViewProps) {
  // 開いた時点の ID（外したお店は下で隠すだけにして、取得し直さない）
  const [initialIds] = useState(ids)
  // 取得できた店舗
  const [items, setItems] = useState<Restaurant[]>([])
  // 見つからなかった店舗 ID
  const [missing, setMissing] = useState<string[]>([])
  // データの取得元（Yelp のクレジット表記に使う）
  const [source, setSource] = useState<LookupResponse["source"] | null>(null)
  // 取得状態（お気に入りが 0 件なら取得しないので ready から始める）
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    initialIds.length > 0 ? "loading" : "ready",
  )
  // API が返したエラーメッセージ
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // 再読み込みボタンを押した回数（変えると再取得が走る）
  const [retryCount, setRetryCount] = useState(0)
  // 絞り込み条件
  const [filters, setFilters] = useState<FavoriteFilters>(DEFAULT_FAVORITE_FILTERS)
  // 並び順
  const [sortKey, setSortKey] = useState<FavoriteSortKey>("added")
  // 絞り込みパネルを開いているか（モバイルのみ使用）
  const [filtersOpen, setFiltersOpen] = useState(false)

  // 開いたとき（と再読み込み時）に店舗情報を取得する
  useEffect(() => {
    // お気に入りがなければ取得しない
    if (initialIds.length === 0) return
    // 画面を閉じたらリクエストを中断するためのコントローラ
    const controller = new AbortController()
    setStatus("loading")
    lookupShops(initialIds, controller.signal)
      // 成功時：結果を状態に反映する
      .then((data) => {
        setItems(data.items)
        setMissing(data.missing)
        setSource(data.source)
        setStatus("ready")
      })
      // 失敗時
      .catch((err) => {
        // 自分で中断したリクエストはエラー扱いしない
        if (err instanceof DOMException && err.name === "AbortError") return
        setErrorMessage(err instanceof ApiError ? err.message : null)
        setStatus("error")
      })
    // 閉じたら中断する
    return () => controller.abort()
  }, [initialIds, retryCount])

  // 今もお気に入りに入っている店舗（お気に入りの順＝新しい順）
  const favorites = useMemo(
    () => ids.flatMap((id) => items.filter((r) => r.id === id)),
    [ids, items],
  )
  // 今もお気に入りに入っているのに、情報を取得できなかった店舗
  const unavailable = missing.filter((id) => ids.includes(id))

  // エリアの選択肢（お気に入り全体から作る）
  const areaOptions = useMemo(() => buildAreaOptions(favorites), [favorites])
  // エリアで絞り込んだ店舗（ジャンルの選択肢はここから作る。検索画面と同じ考え方）
  const inArea = useMemo(() => filterByArea(favorites, filters), [favorites, filters])
  // ジャンルの選択肢 = エリア内のジャンル ＋ 選択中だがエリア内に無いジャンル（0件）
  const genreOptions = useMemo<GenreFacet[]>(() => {
    const facets = genreFacets(inArea)
    // 選択中なのに選択肢に無いジャンルを、お気に入り全体から名前を探して件数 0 で加える
    const all = genreFacets(favorites)
    const missingGenres = filters.genres
      .filter((alias) => !facets.some((g) => g.alias === alias))
      .map((alias) => ({
        alias,
        title: all.find((g) => g.alias === alias)?.title ?? alias,
        count: 0,
      }))
    return [...missingGenres, ...facets]
  }, [inArea, favorites, filters.genres])
  // エリア以外の条件でも絞り込み、並び替えた結果
  const results = useMemo(
    () => sortFavorites(inArea.filter((r) => matchesConditions(r, filters)), sortKey),
    [inArea, filters, sortKey],
  )

  /**
   * 絞り込み条件の 1 項目を更新する。
   * @param key 更新する項目名
   * @param value 新しい値
   * @returns なし
   */
  const update = <K extends keyof FavoriteFilters>(key: K, value: FavoriteFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }))

  // 絞り込み条件が初期値のままか（リセットボタンの無効化に使う）
  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_FAVORITE_FILTERS)
  /** 絞り込み条件を初期値に戻す（引数・返り値なし） */
  const reset = () => setFilters(DEFAULT_FAVORITE_FILTERS)

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      {/* 見出し・件数・戻るボタン */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Heart className="size-5 fill-rose-500 text-rose-500" />
          お気に入り
          <span className="text-sm font-normal text-muted-foreground tabular-nums">
            {ids.length}件
          </span>
          {/* 読み込み中はくるくるアイコン */}
          {status === "loading" && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </h2>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft /> 検索に戻る
        </Button>
      </div>

      {/* 状態に応じて表示する中身を切り替える */}
      {ids.length === 0 ? (
        // お気に入りが 0 件
        <Card className="items-center gap-3 border-dashed py-16 text-center">
          <Heart className="size-10 text-muted-foreground" />
          <p className="font-semibold">お気に入りはまだありません</p>
          <p className="px-4 text-sm text-muted-foreground">
            検索結果のカードにあるハートのボタンを押すと、ここに追加されます。
          </p>
          <Button variant="outline" onClick={onBack}>
            お店を探す
          </Button>
        </Card>
      ) : status === "error" ? (
        // エラー（再読み込みで retryCount を増やして再取得）
        <Card className="items-center gap-3 border-dashed py-16 text-center" role="alert">
          <SearchX className="size-10 text-muted-foreground" />
          <p className="font-semibold">お気に入りのお店の情報を取得できませんでした</p>
          {errorMessage && <p className="px-4 text-sm text-muted-foreground">{errorMessage}</p>}
          <Button variant="outline" onClick={() => setRetryCount((c) => c + 1)}>
            <RotateCcw /> 再読み込み
          </Button>
        </Card>
      ) : status === "loading" ? (
        // 読み込み中
        <p className="py-16 text-center text-sm text-muted-foreground">読み込み中…</p>
      ) : (
        // PC では左に絞り込みパネル（300px）、右に一覧の 2 列
        <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:items-start">
          {/* モバイル：絞り込みパネルの開閉ボタン */}
          <Button
            variant="outline"
            className="w-full justify-between lg:hidden"
            aria-expanded={filtersOpen}
            aria-controls="favorites-filter-panel"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal /> 絞り込み条件
            </span>
            <span className="text-xs text-muted-foreground">{filtersOpen ? "閉じる" : "開く"}</span>
          </Button>

          {/* 絞り込みパネルの外枠：モバイルは開閉、PC は常に表示してスクロールに追従 */}
          <div
            id="favorites-filter-panel"
            className={`${filtersOpen ? "block" : "hidden"} lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain`}
          >
            <FavoritesFilterPanel
              filters={filters}
              areaOptions={areaOptions}
              genreOptions={genreOptions}
              onChange={update}
              onReset={reset}
              resetDisabled={isDefault}
            />
          </div>

          <section aria-label="お気に入りの一覧" className="min-w-0">
            {/* 件数と並び替え */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                <span className="text-2xl font-bold text-foreground tabular-nums">{results.length}</span>
                <span className="ml-1">件（お気に入り {favorites.length} 件中）</span>
              </p>
              {/* 画面には出さず読み上げ用のラベル */}
              <Label htmlFor="favorites-sort" className="sr-only">
                並び替え
              </Label>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as FavoriteSortKey)}>
                <SelectTrigger id="favorites-sort" className="w-40 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FAVORITE_SORT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {results.length > 0 ? (
              // 店舗ごとにカードを表示（画面幅に応じて 1〜3 列）
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {results.map((r) => (
                  <li key={r.id}>
                    <RestaurantCard
                      restaurant={r}
                      distancePrefix={filters.currentLocation ? "現在地から" : ""}
                      favorite
                      onToggleFavorite={() => onToggle(r.id)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              // 条件に合うお気に入りがない
              <Card className="items-center gap-3 border-dashed py-16 text-center">
                <SearchX className="size-10 text-muted-foreground" />
                <p className="font-semibold">条件に合うお気に入りはありません</p>
                <Button variant="outline" onClick={reset} disabled={isDefault}>
                  <RotateCcw /> 条件をリセット
                </Button>
              </Card>
            )}

            {/* 情報を取得できなかったお店があれば、件数と削除ボタンを出す */}
            {unavailable.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                <span>
                  {unavailable.length} 件のお店は情報を取得できませんでした（閉店した可能性があります）
                </span>
                <Button variant="outline" size="sm" onClick={() => onRemove(unavailable)}>
                  お気に入りから削除
                </Button>
              </div>
            )}
          </section>
        </div>
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
        </p>
      )}
    </main>
  )
}
