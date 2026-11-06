// 状態フック useState を読み込む
import { useState } from "react"
// lucide-react のアイコン（車・ハート・画像なし・地図ピン・評価の星・人）を読み込む
import { Car, Heart, ImageOff, MapPin, Star, Users } from "lucide-react"

// バッジ部品
import { Badge } from "@/components/ui/badge"
// ボタン部品
import { Button } from "@/components/ui/button"
// カード部品
import { Card, CardContent } from "@/components/ui/card"
// 距離・金額の整形関数と、店舗の型
import { formatDistance, formatYen, type Restaurant } from "@/data/restaurants"

/** RestaurantCard の引数（props） */
interface RestaurantCardProps {
  /** 表示する店舗 */
  restaurant: Restaurant
  /** 距離の前に付ける説明（ルート検索なら「ルートから」） */
  distancePrefix?: string
  /** お気に入りに登録済みか */
  favorite: boolean
  /** お気に入りの登録・解除を切り替える */
  onToggleFavorite: () => void
  /** お気に入りに追加できないとき（上限に達している）は true */
  favoriteDisabled?: boolean
}

/**
 * 店舗 1 件ぶんのカード（画像・ジャンル・お気に入り・店名・場所・設備・説明・評価・リンク）。
 * @param props RestaurantCardProps を参照
 * @returns カードの JSX
 */
export default function RestaurantCard({
  restaurant: r,
  distancePrefix = "",
  favorite,
  onToggleFavorite,
  favoriteDisabled = false,
}: RestaurantCardProps) {
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
        {/* 右上のお気に入りボタン（登録済みなら塗りつぶしのハート） */}
        <Button
          variant="secondary"
          size="icon"
          className="absolute top-2 right-2 size-9 rounded-full bg-background/90 backdrop-blur hover:bg-background"
          aria-label={
            favorite
              ? `${r.name}をお気に入りから外す`
              : favoriteDisabled
                ? "お気に入りは上限に達しています"
                : `${r.name}をお気に入りに追加`
          }
          aria-pressed={favorite}
          disabled={!favorite && favoriteDisabled}
          onClick={onToggleFavorite}
        >
          <Heart className={favorite ? "fill-rose-500 text-rose-500" : "text-muted-foreground"} />
        </Button>
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
        {/* 設備（Yelp で「あり」と分かっているものだけ表示） */}
        {(r.parking || r.good_for_groups) && (
          <ul className="flex flex-wrap gap-1.5" aria-label="設備">
            {r.parking && (
              <li className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                <Car className="size-3.5" /> 駐車場あり
              </li>
            )}
            {r.good_for_groups && (
              <li className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                <Users className="size-3.5" /> 大人数OK
              </li>
            )}
          </ul>
        )}
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
