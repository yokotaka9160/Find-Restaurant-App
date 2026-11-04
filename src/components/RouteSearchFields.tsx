// 状態フック useState と、フォーム送信イベント・React 要素の型を読み込む
import { useState, type FormEvent, type ReactNode } from "react"
// lucide-react のアイコン（入れ替え・旗・読み込み中・現在地・ピン・検索・閉じる）を読み込む
import { ArrowDownUp, Flag, Loader2, LocateFixed, MapPin, Search, X } from "lucide-react"

// ボタン部品を読み込む
import { Button } from "@/components/ui/button"
// ラベル部品を読み込む
import { Label } from "@/components/ui/label"
// セレクトボックス部品一式を読み込む
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
// API エラー型・距離の選択肢・距離整形関数・地名検索関数と、関連する型を読み込む
import {
  ApiError,
  ROUTE_BUFFER_OPTIONS,
  formatDistance,
  geocode,
  type GeocodeResult,
  type RoutePoint,
} from "@/data/restaurants"
// 現在地を取得するフックを読み込む
import { useGeolocation } from "@/hooks/useGeolocation"

/* ------------------------------------------------------------------ */
/* ルート検索の条件：出発地・目的地・ルートからの距離                       */
/* ------------------------------------------------------------------ */

/** RouteSearchFields の引数（props） */
interface RouteSearchFieldsProps {
  /** 出発地（未設定なら null） */
  origin: RoutePoint | null
  /** 目的地（未設定なら null） */
  destination: RoutePoint | null
  /** ルートからの距離（m） */
  bufferM: number
  /** 出発地が変わったときに呼ばれる */
  onOriginChange: (p: RoutePoint | null) => void
  /** 目的地が変わったときに呼ばれる */
  onDestinationChange: (p: RoutePoint | null) => void
  /** ルートからの距離が変わったときに呼ばれる */
  onBufferChange: (m: number) => void
}

/**
 * ルート検索の入力欄（出発地・目的地・入れ替えボタン・ルートからの距離）。
 * @param props RouteSearchFieldsProps を参照
 * @returns 入力欄一式の JSX
 */
export default function RouteSearchFields({
  origin,
  destination,
  bufferM,
  onOriginChange,
  onDestinationChange,
  onBufferChange,
}: RouteSearchFieldsProps) {
  /** 出発地と目的地を入れ替える（引数・返り値なし） */
  const swap = () => {
    // 新しい出発地 = 今の目的地
    onOriginChange(destination)
    // 新しい目的地 = 今の出発地
    onDestinationChange(origin)
  }

  return (
    <div className="space-y-3">
      {/* 出発地の入力欄（現在地ボタンあり） */}
      <RoutePointField
        id="route-origin"
        label="出発地"
        icon={<MapPin className="size-4 text-emerald-600" />}
        value={origin}
        onChange={onOriginChange}
        allowCurrentLocation
      />
      {/* 入れ替えボタン（出発地・目的地がどちらも未設定なら無効） */}
      <div className="flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={swap}
          disabled={!origin && !destination}
        >
          <ArrowDownUp /> 入れ替え
        </Button>
      </div>
      {/* 目的地の入力欄 */}
      <RoutePointField
        id="route-destination"
        label="目的地"
        icon={<Flag className="size-4 text-rose-600" />}
        value={destination}
        onChange={onDestinationChange}
      />
      {/* ルートからの距離の選択欄 */}
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="route-buffer" className="font-normal text-muted-foreground">
          ルートからの距離
        </Label>
        {/* Select の値は文字列なので、数値と相互変換する */}
        <Select value={String(bufferM)} onValueChange={(v) => onBufferChange(Number(v))}>
          <SelectTrigger id="route-buffer" className="w-28 bg-background">
            {/* 選択中の値を表示 */}
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* 距離の選択肢を 1 つずつ項目にする */}
            {ROUTE_BUFFER_OPTIONS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {formatDistance(m)} 以内
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 地点の入力：地名検索（Nominatim）→ 候補から選ぶ／現在地                  */
/* ------------------------------------------------------------------ */

/** RoutePointField の引数（props） */
interface RoutePointFieldProps {
  /** 入力欄の id（label と紐付ける） */
  id: string
  /** 見出し（例: 出発地） */
  label: string
  /** 選択済み表示で使うアイコン */
  icon: ReactNode
  /** 選択済みの地点（未選択なら null） */
  value: RoutePoint | null
  /** 地点が選ばれた／解除されたときに呼ばれる */
  onChange: (p: RoutePoint | null) => void
  /** 「現在地を出発地にする」ボタンを出すか（省略時 false） */
  allowCurrentLocation?: boolean
}

/**
 * 1 地点ぶんの入力欄。地名で検索して候補から選ぶか、現在地を使う。
 * 選択済みなら地点名と解除ボタンを表示する。
 * @param props RoutePointFieldProps を参照
 * @returns 入力欄の JSX
 */
function RoutePointField({
  id,
  label,
  icon,
  value,
  onChange,
  allowCurrentLocation = false,
}: RoutePointFieldProps) {
  // 入力中の検索語
  const [query, setQuery] = useState("")
  // 地名検索の候補（未検索・選択後は null）
  const [candidates, setCandidates] = useState<GeocodeResult[] | null>(null)
  // 地名検索中かどうか
  const [searching, setSearching] = useState(false)
  // 地名検索のエラーメッセージ
  const [error, setError] = useState<string | null>(null)
  // 現在地取得フック
  const geo = useGeolocation()

  /**
   * 地名検索を実行する。
   * Nominatim の利用規約に従い、入力中の自動補完はせず検索ボタン（Enter）で 1 回だけ呼ぶ
   * @param e フォーム送信イベント
   * @returns なし（Promise）
   */
  const search = async (e: FormEvent) => {
    // フォーム送信によるページ遷移を止める
    e.preventDefault()
    // 前後の空白を除いた検索語
    const q = query.trim()
    // 空なら何もしない
    if (!q) return
    // 検索中にし、前回のエラーを消す
    setSearching(true)
    setError(null)
    try {
      // バックエンド経由で地名検索する
      const results = await geocode(q)
      // 候補を保存する
      setCandidates(results)
      // 0 件ならメッセージを出す
      if (results.length === 0) setError("見つかりませんでした。別の地名で試してください")
    } catch (err) {
      // 失敗したら候補を消し、API のメッセージ（なければ汎用メッセージ）を出す
      setCandidates(null)
      setError(err instanceof ApiError ? err.message : "地名を検索できませんでした")
    } finally {
      // 成否にかかわらず検索中を解除する
      setSearching(false)
    }
  }

  /**
   * 候補を選んで地点として確定する。
   * @param r 選んだ候補
   * @returns なし
   */
  const select = (r: GeocodeResult) => {
    // 「名称, 住所…」の先頭（名称）だけを取り出す
    const [name] = r.name.split(",")
    // 名称と座標を地点として親に渡す
    onChange({ label: name.trim(), lat: r.lat, lng: r.lng })
    // 候補一覧を閉じる
    setCandidates(null)
    // 入力欄を空にする
    setQuery("")
  }

  // 地点が選択済みなら、地点名と解除ボタンだけを表示する
  if (value) {
    return (
      <div className="space-y-1">
        {/* 見出し */}
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
          {/* 地点の種類のアイコン */}
          {icon}
          {/* 地点名（長い場合は省略し、ホバーで全文） */}
          <span className="min-w-0 flex-1 truncate" title={value.label}>
            {value.label}
          </span>
          {/* 解除ボタン：null を渡して未選択に戻す */}
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={`${label}を解除`}
            onClick={() => onChange(null)}
          >
            <X />
          </Button>
        </div>
      </div>
    )
  }

  // 未選択なら、検索フォーム・候補一覧・現在地ボタン・エラーを表示する
  return (
    <div className="space-y-1.5">
      {/* 見出し（入力欄と紐付け） */}
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      {/* 送信（Enter/検索ボタン）で search を実行 */}
      <form onSubmit={search} className="flex gap-1.5">
        {/* 検索語の入力欄 */}
        <input
          id={id}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="駅名・住所・施設名"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        {/* 検索ボタン（検索中または未入力なら無効） */}
        <Button
          type="submit"
          variant="outline"
          size="icon"
          aria-label={`${label}を検索`}
          disabled={searching || !query.trim()}
        >
          {/* 検索中はくるくるアイコン、それ以外は虫眼鏡 */}
          {searching ? <Loader2 className="animate-spin" /> : <Search />}
        </Button>
      </form>

      {/* 候補が 1 件以上あれば一覧を表示する */}
      {candidates && candidates.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-md border bg-background text-sm">
          {candidates.map((c) => {
            // 先頭を名称、残りを住所として分ける
            const [name, ...rest] = c.name.split(",")
            return (
              // 座標をキーにする
              <li key={`${c.lat},${c.lng}`}>
                {/* クリックでこの候補を選ぶ */}
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onClick={() => select(c)}
                >
                  {/* 名称 */}
                  <span className="block font-medium">{name}</span>
                  {/* 住所（残りをつなぎ直して表示） */}
                  <span className="block truncate text-xs text-muted-foreground">
                    {rest.join(",").trim()}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* 現在地ボタン（許可されている欄のみ） */}
      {allowCurrentLocation && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={geo.locating}
          // 取得できたら「現在地」というラベルを付けて地点にする
          onClick={() => geo.locate((p) => onChange({ ...p, label: "現在地" }))}
        >
          {/* 取得中はくるくるアイコンと文言を切り替える */}
          {geo.locating ? <Loader2 className="animate-spin" /> : <LocateFixed />}
          {geo.locating ? "現在地を取得中…" : "現在地を出発地にする"}
        </Button>
      )}

      {/* 地名検索または現在地取得のエラーがあれば表示する */}
      {(error || geo.error) && (
        <p className="text-xs text-destructive" role="alert">
          {error || geo.error}
        </p>
      )}
    </div>
  )
}
