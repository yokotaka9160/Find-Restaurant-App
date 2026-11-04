// 副作用フック useEffect と、再描画をまたいで値を保持する useRef を読み込む
import { useEffect, useRef } from "react"
// 地図ライブラリ Leaflet を読み込む
import L from "leaflet"
// Leaflet の標準スタイルを読み込む
import "leaflet/dist/leaflet.css"

// 金額整形関数と、座標・店舗・ルート・地点の型を読み込む
import {
  formatYen,
  type GeoPoint,
  type Restaurant,
  type RouteInfo,
  type RoutePoint,
} from "@/data/restaurants"

/* ------------------------------------------------------------------ */
/* 店舗の位置を地図（Leaflet + OpenStreetMap）に表示する                  */
/* ------------------------------------------------------------------ */

/** 検索結果がまだないときの初期表示位置 */
const TOKYO_STATION: L.LatLngTuple = [35.6812, 139.7671]

/** ShopMap の引数（props） */
interface ShopMapProps {
  /** 地図に表示する店舗 */
  restaurants: Restaurant[]
  /** 現在地検索中なら、現在地と検索範囲の円を表示する */
  currentLocation: GeoPoint | null
  /** 現在地検索の半径（km） */
  radiusKm: number
  /** ルート検索中なら、ルートと出発地・目的地を表示する */
  route?: RouteInfo | null
  origin?: RoutePoint | null
  destination?: RoutePoint | null
}

/**
 * 店舗・現在地・ルートを地図に表示する。
 * @param props ShopMapProps を参照
 * @returns 地図と補足メッセージの JSX
 */
export default function ShopMap({
  restaurants,
  currentLocation,
  radiusKm,
  route = null,
  origin = null,
  destination = null,
}: ShopMapProps) {
  // 地図を描画する div 要素への参照
  const containerRef = useRef<HTMLDivElement>(null)
  // Leaflet の地図インスタンス
  const mapRef = useRef<L.Map | null>(null)
  // マーカーやルートをまとめて消せるようにするレイヤーグループ
  const layerRef = useRef<L.LayerGroup | null>(null)

  // 地図本体はマウント時に 1 回だけ作る
  useEffect(() => {
    // 描画先の要素がまだなければ何もしない
    if (!containerRef.current) return
    // 地図を作成し、東京駅をズーム 12 で表示する
    const map = L.map(containerRef.current).setView(TOKYO_STATION, 12)
    // OpenStreetMap のタイル（地図画像）を背景として追加する
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, // 最大ズーム
      // 利用規約で必要な著作権表示
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map)
    // 地図インスタンスを保存する
    mapRef.current = map
    // マーカー用のレイヤーグループを作って地図に追加・保存する
    layerRef.current = L.layerGroup().addTo(map)
    // アンマウント時に地図を破棄し、参照を消す
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  // 検索結果が変わるたびにマーカーを描き直し、全体が見えるように表示範囲を合わせる
  useEffect(() => {
    // 地図とレイヤーを取り出す
    const map = mapRef.current
    const layer = layerRef.current
    // まだ作成されていなければ何もしない
    if (!map || !layer) return
    // 前回描いたマーカー・ルートをすべて消す
    layer.clearLayers()

    // 表示範囲に含める地点
    const points: L.LatLng[] = []

    // 現在地検索中の場合
    if (currentLocation) {
      // 現在地の座標
      const center = L.latLng(currentLocation.lat, currentLocation.lng)
      // 検索範囲を表す半透明の円（半径は km → m）
      L.circle(center, {
        radius: radiusKm * 1000,
        className: "map-me-range",
        weight: 1,
        fillOpacity: 0.06,
        interactive: false, // クリックなどに反応しない
      }).addTo(layer)
      // 現在地の丸いマーカー（ホバーで「現在地」）
      L.circleMarker(center, { radius: 8, className: "map-me-marker", weight: 3, fillOpacity: 1 })
        .bindTooltip("現在地")
        .addTo(layer)
      // 検索範囲の円全体が収まるようにする
      const range = center.toBounds(radiusKm * 2000)
      // 円を囲む矩形の南西・北東の角を表示範囲に加える
      points.push(range.getSouthWest(), range.getNorthEast())
    }

    // ルートは店舗マーカーより下に描く（先に追加したものが下になる）
    if (route) {
      // [lat, lng] の配列を Leaflet の座標に変換する
      const line = route.coordinates.map(([lat, lng]) => L.latLng(lat, lng))
      // 縁取り用の太い線
      L.polyline(line, { className: "map-route-casing", weight: 9, interactive: false }).addTo(layer)
      // ルート本体の線
      L.polyline(line, { className: "map-route", weight: 5, interactive: false }).addTo(layer)
      // ルート全体を表示範囲に加える
      points.push(...line)
    }
    // 出発地・目的地のマーカーを描く
    for (const [point, kind] of [
      [origin, "出発地"],
      [destination, "目的地"],
    ] as const) {
      // 未設定ならスキップ
      if (!point) continue
      // 地点の座標
      const pos = L.latLng(point.lat, point.lng)
      // 出発地・目的地でクラス（色）を変えた丸いマーカー
      L.circleMarker(pos, {
        radius: 9,
        className: kind === "出発地" ? "map-origin-marker" : "map-destination-marker",
        weight: 3,
        fillOpacity: 1,
      })
        .bindTooltip(`${kind}：${point.label}`) // ホバーで種類と地点名
        .addTo(layer)
      // 表示範囲に加える
      points.push(pos)
    }

    // 店舗のマーカーを描く
    for (const r of restaurants) {
      // 座標がない店舗はスキップ
      if (r.lat == null || r.lng == null) continue
      // 店舗の座標
      const pos = L.latLng(r.lat, r.lng)
      // 店舗の丸いマーカー
      const marker = L.circleMarker(pos, {
        radius: 9,
        className: "map-shop-marker",
        weight: 2,
        fillOpacity: 0.9,
      })
        .bindTooltip(r.name, { direction: "top", offset: [0, -8] }) // ホバーで店名を上に表示
        .bindPopup(() => popupContent(r), { minWidth: 200 }) // クリックで詳細ポップアップ
        .addTo(layer)
      // ポップアップを開いたらマーカーを強調表示する
      marker.on("popupopen", () => marker.getElement()?.classList.add("map-shop-marker--active"))
      // 閉じたら強調を解除する
      marker.on("popupclose", () => marker.getElement()?.classList.remove("map-shop-marker--active"))
      // 表示範囲に加える
      points.push(pos)
    }

    // 地点が 1 つ以上あれば、すべてが収まるように表示範囲を合わせる（余白 32px、最大ズーム 16）
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 16 })
    }
  }, [restaurants, currentLocation, radiusKm, route, origin, destination])

  // 座標がなく地図に出せない店舗の数
  const missing = restaurants.filter((r) => r.lat == null || r.lng == null).length

  return (
    <div className="space-y-2">
      {/* isolate：Leaflet の高い z-index が固定ヘッダーに重ならないようにする */}
      <div
        ref={containerRef}
        className="isolate h-[min(70vh,640px)] w-full overflow-hidden rounded-xl border bg-muted"
        role="region"
        aria-label="店舗の地図"
      />
      {/* 地図に出せない店舗があれば件数を知らせる */}
      {missing > 0 && (
        <p className="text-xs text-muted-foreground">
          位置情報のない {missing} 件は地図に表示されていません
        </p>
      )}
    </div>
  )
}

/**
 * ポップアップの中身。店名などは外部（Yelp）由来なので innerHTML ではなく textContent で入れる
 * @param r 表示する店舗
 * @returns ポップアップに入れる DOM 要素
 */
function popupContent(r: Restaurant): HTMLElement {
  // 外枠の要素
  const root = document.createElement("div")
  root.className = "space-y-1 text-sm"

  // 店名の段落
  const name = document.createElement("p")
  name.className = "!m-0 font-semibold"
  name.textContent = r.name

  // 評価・レビュー数・ジャンル・平均予算の段落
  const meta = document.createElement("p")
  meta.className = "!m-0 text-xs text-muted-foreground"
  meta.textContent = `★${r.rating.toFixed(1)}（${r.review_count.toLocaleString("ja-JP")}件）｜${r.genre}｜平均 ${formatYen(r.budget)}`

  // 外枠に店名とメタ情報を追加する
  root.append(name, meta)

  // Yelp のページがあればリンクを追加する
  if (r.url) {
    const link = document.createElement("a")
    link.href = r.url
    link.target = "_blank" // 新しいタブで開く
    link.rel = "noreferrer" // 遷移先にリファラーを渡さない
    link.className = "inline-block pt-1 text-xs font-medium"
    link.textContent = "Yelpで見る →"
    root.append(link)
  }
  // 完成した要素を返す
  return root
}
