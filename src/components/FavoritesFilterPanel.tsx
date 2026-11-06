// lucide-react のアイコン（地図ピン・リセット）を読み込む
import { MapPin, RotateCcw } from "lucide-react"

// ボタン部品
import { Button } from "@/components/ui/button"
// カード部品一式
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
// セレクトボックス部品一式
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
// 絞り込み条件の入力欄（現在地・設備・予算・ジャンル・評価）
import {
  BudgetField,
  FacilityField,
  GenreField,
  LocationField,
  RatingField,
} from "@/components/FilterFields"
// エリアの選択肢・絞り込み条件の型
import type { AreaOption, FavoriteFilters } from "@/data/favorites"
// 「すべて」を表す値と、ジャンルの型
import { ALL_AREAS, type GenreFacet } from "@/data/restaurants"

/** FavoritesFilterPanel の引数（props） */
interface FavoritesFilterPanelProps {
  /** 現在の絞り込み条件 */
  filters: FavoriteFilters
  /** エリアの選択肢（お気に入りに含まれる都道府県・市区町村） */
  areaOptions: AreaOption[]
  /** ジャンルの選択肢（エリア内のお気に入りから作る） */
  genreOptions: GenreFacet[]
  /** 条件の 1 項目を変更する関数 */
  onChange: <K extends keyof FavoriteFilters>(key: K, value: FavoriteFilters[K]) => void
  /** 条件をリセットする関数 */
  onReset: () => void
  /** リセットボタンを無効にするか */
  resetDisabled: boolean
}

/**
 * お気に入りの絞り込みパネル（エリア/現在地・設備・予算・ジャンル・評価）。
 * エリアの選択肢は、お気に入りに含まれる都道府県・市区町村だけを件数付きで出す。
 * @param props FavoritesFilterPanelProps を参照
 * @returns パネルの JSX
 */
export default function FavoritesFilterPanel({
  filters,
  areaOptions,
  genreOptions,
  onChange,
  onReset,
  resetDisabled,
}: FavoritesFilterPanelProps) {
  // 選択中の都道府県の市区町村（「すべて」なら空）
  const cities = areaOptions.find((o) => o.prefecture === filters.prefecture)?.cities ?? []

  /**
   * 都道府県を変更する（市区町村は「全域」に戻す）。
   * @param prefecture 新しい都道府県名（ALL_AREAS ならすべて）
   * @returns なし
   */
  const changePrefecture = (prefecture: string) => {
    onChange("prefecture", prefecture)
    onChange("area", ALL_AREAS)
  }

  return (
    <Card className="gap-5 py-5">
      {/* 見出しとリセットボタン */}
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="text-base">絞り込み</CardTitle>
        <Button variant="ghost" size="sm" onClick={onReset} disabled={resetDisabled}>
          <RotateCcw /> リセット
        </Button>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* エリア：現在地 or 都道府県 → 市区町村 */}
        <LocationField
          labelFor="favorites-prefecture"
          location={filters.currentLocation}
          radiusKm={filters.radiusKm}
          onLocationChange={(p) => onChange("currentLocation", p)}
          onRadiusChange={(km) => onChange("radiusKm", km)}
        >
          {/* 都道府県の選択（お気に入りにある都道府県だけ、件数付き） */}
          <Select value={filters.prefecture} onValueChange={changePrefecture}>
            <SelectTrigger id="favorites-prefecture" className="bg-background">
              <MapPin className="text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value={ALL_AREAS}>すべての都道府県</SelectItem>
              {areaOptions.map((o) => (
                <SelectItem key={o.prefecture} value={o.prefecture}>
                  {o.prefecture}（{o.count}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* 市区町村の選択（都道府県を選んだときだけ選べる） */}
          <Select
            value={filters.area}
            onValueChange={(v) => onChange("area", v)}
            disabled={filters.prefecture === ALL_AREAS}
          >
            <SelectTrigger aria-label="市区町村" className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {/* 都道府県全域（都道府県が「すべて」のときは「市区町村：すべて」） */}
              <SelectItem value={ALL_AREAS}>
                {filters.prefecture === ALL_AREAS ? "すべての市区町村" : `${filters.prefecture}全域`}
              </SelectItem>
              {/* 選択中の都道府県の市区町村 */}
              {cities.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name}（{c.count}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LocationField>

        {/* 設備（駐車場・大人数） */}
        <FacilityField
          parking={filters.parking}
          groups={filters.groups}
          onChange={(key, value) => onChange(key, value)}
        />

        {/* 予算 */}
        <BudgetField value={filters.budget} onChange={(v) => onChange("budget", v)} />

        {/* ジャンル */}
        <GenreField
          options={genreOptions}
          selected={filters.genres}
          onChange={(genres) => onChange("genres", genres)}
          emptyMessage="このエリアのお気に入りはありません"
        />

        {/* 評価 */}
        <RatingField value={filters.rating} onChange={(v) => onChange("rating", v)} />
      </CardContent>
    </Card>
  )
}
