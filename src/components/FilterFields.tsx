/**
 * 絞り込み条件の入力欄（現在地・設備・予算・ジャンル・評価）。
 * 検索画面の条件パネルと、お気に入りの絞り込みパネルで共通に使う。
 */

// 状態フック useState と、子要素の型を読み込む
import { useState, type ReactNode } from "react"
// lucide-react のアイコン（車・読み込み中・現在地・評価の星・人・閉じる）を読み込む
import { Car, Loader2, LocateFixed, Star, Users, X } from "lucide-react"

// ボタン部品
import { Button } from "@/components/ui/button"
// チェックボックス部品
import { Checkbox } from "@/components/ui/checkbox"
// ラベル部品
import { Label } from "@/components/ui/label"
// スライダー部品
import { Slider } from "@/components/ui/slider"
// 予算・半径・評価の範囲、金額の整形関数、座標・ジャンルの型
import {
  BUDGET_MAX,
  BUDGET_MIN,
  BUDGET_STEP,
  RADIUS_MAX_KM,
  RADIUS_MIN_KM,
  RATING_MAX,
  RATING_MIN,
  formatYen,
  type GenreFacet,
  type GeoPoint,
} from "@/data/restaurants"
// 現在地を取得するフック
import { useGeolocation } from "@/hooks/useGeolocation"

/** ジャンルの選択肢を最初に表示する数（残りは「もっと見る」） */
const GENRE_PREVIEW_COUNT = 12

/* ------------------------------------------------------------------ */
/* エリア：現在地 or 子要素（都道府県・市区町村の選択）                    */
/* ------------------------------------------------------------------ */

/** LocationField の引数（props） */
interface LocationFieldProps {
  /** 見出しのラベルと紐付ける入力欄の id */
  labelFor: string
  /** 現在地（未設定なら null） */
  location: GeoPoint | null
  /** 現在地からの半径（km） */
  radiusKm: number
  /** 現在地が変わったときに呼ばれる（解除なら null） */
  onLocationChange: (p: GeoPoint | null) => void
  /** 半径が変わったときに呼ばれる */
  onRadiusChange: (km: number) => void
  /** 現在地を使っていないときに表示するエリアの選択欄 */
  children: ReactNode
}

/**
 * エリアの入力欄。現在地を使っているときは半径のスライダーを、使っていないときは children（エリアの選択欄）と
 * 「現在地から探す」ボタンを表示する。
 * @param props LocationFieldProps を参照
 * @returns 入力欄の JSX
 */
export function LocationField({
  labelFor,
  location,
  radiusKm,
  onLocationChange,
  onRadiusChange,
  children,
}: LocationFieldProps) {
  // 現在地取得フック
  const geo = useGeolocation()

  return (
    <div className="space-y-2">
      <Label htmlFor={labelFor}>エリア</Label>
      {location ? (
        // 現在地を使用中：半径の表示・解除ボタン・半径スライダー
        <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <LocateFixed className="size-4 text-primary" />
              現在地から
              <span className="font-medium tabular-nums text-primary">{radiusKm}km</span>
              以内
            </span>
            {/* 現在地を解除してエリアの選択に戻す */}
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="現在地での検索を解除"
              onClick={() => onLocationChange(null)}
            >
              <X />
            </Button>
          </div>
          {/* 半径（km）のスライダー */}
          <Slider
            min={RADIUS_MIN_KM}
            max={RADIUS_MAX_KM}
            step={1}
            value={[radiusKm]}
            thumbLabels={["現在地からの距離（km）"]}
            onValueChange={(v) => onRadiusChange(v[0])}
          />
          {/* スライダーの両端の目盛り */}
          <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>{RADIUS_MIN_KM}km</span>
            <span>{RADIUS_MAX_KM}km</span>
          </div>
        </div>
      ) : (
        // エリアの選択欄（呼び出し側が用意する）
        children
      )}
      {/* 現在地を使っていなければ「現在地から探す」ボタンを出す */}
      {!location && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          // 取得できたら現在地を条件に入れる
          onClick={() => geo.locate(onLocationChange)}
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
  )
}

/* ------------------------------------------------------------------ */
/* 設備（駐車場・大人数）                                                */
/* ------------------------------------------------------------------ */

/** 設備の条件の項目名 */
export type FacilityKey = "parking" | "groups"

/**
 * 設備のチェックボックス（駐車場あり・大人数OK）。
 * @param parking 駐車場ありを選択中か
 * @param groups 大人数OK を選択中か
 * @param onChange 選択が変わったときに呼ばれる（項目名, 選択したか）
 * @returns 入力欄の JSX
 */
export function FacilityField({
  parking,
  groups,
  onChange,
}: {
  parking: boolean
  groups: boolean
  onChange: (key: FacilityKey, value: boolean) => void
}) {
  // 項目名 → 選択中か
  const values: Record<FacilityKey, boolean> = { parking, groups }

  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-sm leading-none font-medium">設備</legend>
      {/* [項目名, id, 表示名, アイコン] の組からチェックボックスを作る */}
      {(
        [
          ["parking", "facility-parking", "駐車場あり", Car],
          ["groups", "facility-groups", "大人数（4人以上）OK", Users],
        ] as const
      ).map(([key, id, label, Icon]) => (
        <div key={key} className="flex items-center gap-2">
          {/* c は true/false/"indeterminate" なので true のみ選択扱い */}
          <Checkbox id={id} checked={values[key]} onCheckedChange={(c) => onChange(key, c === true)} />
          <Label htmlFor={id} className="cursor-pointer font-normal">
            <Icon className="size-4 text-muted-foreground" />
            {label}
          </Label>
        </div>
      ))}
      {/* Yelp の情報がない店は条件に合うか分からないので除外されることを伝える */}
      <p className="text-xs text-muted-foreground">Yelp に設備の情報がないお店は表示されません</p>
    </fieldset>
  )
}

/* ------------------------------------------------------------------ */
/* 予算                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 1人あたり予算の範囲スライダー。上限を最大にしたときは「◯円以上」（上限なし）と表示する。
 * @param value 予算の範囲 [下限, 上限]（円）
 * @param onChange 範囲が変わったときに呼ばれる
 * @returns 入力欄の JSX
 */
export function BudgetField({
  value,
  onChange,
}: {
  value: [number, number]
  onChange: (value: [number, number]) => void
}) {
  // 予算の下限・上限
  const [min, max] = value

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label>予算（1人あたり）</Label>
        {/* 選択中の範囲。上限が最大なら「◯円以上」 */}
        <span className="text-sm font-medium tabular-nums text-primary">
          {formatYen(min)} 〜 {max >= BUDGET_MAX ? `${formatYen(BUDGET_MAX)}以上` : formatYen(max)}
        </span>
      </div>
      {/* 下限・上限の 2 つのつまみを持つスライダー（つまみ同士は 1 目盛り以上離す） */}
      <Slider
        min={BUDGET_MIN}
        max={BUDGET_MAX}
        step={BUDGET_STEP}
        minStepsBetweenThumbs={1}
        value={value}
        thumbLabels={["予算の下限", "予算の上限"]}
        onValueChange={(v) => onChange([v[0], v[1]])}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* ジャンル                                                             */
/* ------------------------------------------------------------------ */

/**
 * ジャンルのチェックボックス（2 列、件数付き）。多いときは先頭だけ表示し「もっと見る」で全件表示する。
 * @param options ジャンルの選択肢（件数の多い順）
 * @param selected 選択中のジャンル（alias）。空なら「すべて」
 * @param onChange 選択が変わったときに呼ばれる（新しい選択の配列）
 * @param emptyMessage 選択肢がないときに表示する文
 * @returns 入力欄の JSX
 */
export function GenreField({
  options,
  selected,
  onChange,
  emptyMessage,
}: {
  options: GenreFacet[]
  selected: string[]
  onChange: (genres: string[]) => void
  emptyMessage: string
}) {
  // ジャンルをすべて表示するか
  const [showAll, setShowAll] = useState(false)
  // 表示するジャンル（すべて or 先頭 GENRE_PREVIEW_COUNT 件）
  const visible = showAll ? options : options.slice(0, GENRE_PREVIEW_COUNT)

  /**
   * ジャンルの選択を切り替える。
   * @param alias ジャンルの ID
   * @param checked チェックされたら true
   * @returns なし
   */
  const toggle = (alias: string, checked: boolean) =>
    // チェックなら追加、外したら取り除く
    onChange(checked ? [...selected, alias] : selected.filter((g) => g !== alias))

  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-sm leading-none font-medium">
        ジャンル
        {/* 選択数（0 件なら「すべて」） */}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {selected.length === 0 ? "すべて" : `${selected.length}件選択`}
        </span>
      </legend>
      {options.length === 0 ? (
        // 選択肢がないとき
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      ) : (
        // 2 列でチェックボックスを並べる
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          {visible.map((g) => (
            <div key={g.alias} className="flex min-w-0 items-center gap-2">
              {/* 選択中なら checked。c は true/false/"indeterminate" なので true のみ選択扱い */}
              <Checkbox
                id={`genre-${g.alias}`}
                checked={selected.includes(g.alias)}
                onCheckedChange={(c) => toggle(g.alias, c === true)}
              />
              {/* ジャンル名と件数（クリックでもチェック切り替え） */}
              <Label
                htmlFor={`genre-${g.alias}`}
                className="min-w-0 cursor-pointer font-normal"
                title={g.title}
              >
                <span className="truncate">{g.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{g.count}</span>
              </Label>
            </div>
          ))}
        </div>
      )}
      {/* 選択肢が多いときは「もっと見る／閉じる」ボタンを出す */}
      {options.length > GENRE_PREVIEW_COUNT && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "閉じる" : `もっと見る（残り${options.length - GENRE_PREVIEW_COUNT}件）`}
        </Button>
      )}
    </fieldset>
  )
}

/* ------------------------------------------------------------------ */
/* 評価                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 評価の範囲スライダー（0.5 刻み）。全範囲のときは「指定なし」と表示する。
 * @param value 評価の範囲 [下限, 上限]
 * @param onChange 範囲が変わったときに呼ばれる
 * @returns 入力欄の JSX
 */
export function RatingField({
  value,
  onChange,
}: {
  value: [number, number]
  onChange: (value: [number, number]) => void
}) {
  // 評価の下限・上限
  const [min, max] = value

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label>評価</Label>
        {/* 初期値のままなら「指定なし」、それ以外は星と範囲 */}
        <span className="flex items-center gap-1 text-sm font-medium tabular-nums text-primary">
          {min === RATING_MIN && max === RATING_MAX ? (
            "指定なし"
          ) : (
            <>
              <Star className="size-3.5 fill-amber-400 text-amber-400" />
              {min.toFixed(1)} 〜 {max.toFixed(1)}
            </>
          )}
        </span>
      </div>
      {/* 評価の下限・上限スライダー（0.5 刻み） */}
      <Slider
        min={RATING_MIN}
        max={RATING_MAX}
        step={0.5}
        value={value}
        thumbLabels={["評価の下限", "評価の上限"]}
        onValueChange={(v) => onChange([v[0], v[1]])}
      />
    </div>
  )
}
