// 副作用フック useEffect と状態フック useState を読み込む
import { useEffect, useState } from "react"

// 飲食店検索画面のコンポーネントを RestaurantSearch という名前で読み込む
import RestaurantSearch from "@/components/ShopSearch"

/**
 * アプリのロゴマーク（ピン・ルート・端末の図形を CSS で描く）。
 * @param compact true のとき小さいサイズで表示する（省略時 false）
 * @returns ロゴマークの JSX
 */
function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    // compact かどうかでクラスを切り替える。装飾なのでスクリーンリーダーからは隠す
    <div
      className={compact ? "brand-mark brand-mark--compact" : "brand-mark"}
      aria-hidden="true"
    >
      {/* 地図ピンの図形 */}
      <div className="brand-pin">
        {/* ピン中央の丸 */}
        <span />
      </div>
      {/* ルートを表す線 */}
      <div className="brand-route" />
      {/* 端末の図形（1 つ目） */}
      <div className="brand-device brand-device--one" />
      {/* 端末の図形（2 つ目） */}
      <div className="brand-device brand-device--two" />
    </div>
  )
}

/**
 * ホーム画面の料理イラスト（フォーク・ナイフ・炎などを SVG で描く）。
 * @returns SVG イラストの JSX（引数なし）
 */
function HeroIllustration() {
  return (
    // 580x500 の座標系で描く装飾用 SVG
    <svg className="hero-illustration" viewBox="0 0 580 500" aria-hidden="true">
      {/* 再利用するグラデーションの定義 */}
      <defs>
        {/* 水色 → 青 → 紫の斜めグラデーション */}
        <linearGradient id="heroGradient" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#15d6d2" />
          <stop offset=".58" stopColor="#2947e8" />
          <stop offset="1" stopColor="#c636f0" />
        </linearGradient>
        {/* 黄 → ピンクの暖色グラデーション */}
        <linearGradient id="warmGradient" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffca6a" />
          <stop offset="1" stopColor="#ff7f87" />
        </linearGradient>
      </defs>
      {/* 左側のフォーク（4 本の歯と柄） */}
      <path
        d="M74 80v93M64 80v56M84 80v56M54 80v56M54 136c0 18 30 18 30 0M69 173v165"
        className="hero-stroke"
      />
      {/* 右側のナイフ */}
      <path d="M366 330V72c66 64 74 157 3 206" className="hero-knife" />
      {/* 炎の太い線 */}
      <path
        d="M251 123c-23 23-40 64-39 118 2 59-28 105-61 156"
        className="hero-flame"
      />
      {/* 炎の細い線 */}
      <path
        d="M237 142c25 41 13 73-6 103M255 144c14 27 14 56-1 83"
        className="hero-flame thin"
      />
      {/* 中央の斜めのフォーク */}
      <path
        d="m222 315 97-211M243 338l94-204M222 315l29 14M234 290l30 15M246 264l29 15"
        className="hero-stroke hero-fork"
      />
      {/* グラデーションで塗ったひし形 */}
      <path d="m166 57 60 62-62 64-63-62z" fill="url(#heroGradient)" />
      {/* ひし形に重なる白い円の輪郭 */}
      <circle
        cx="164"
        cy="120"
        r="44"
        fill="none"
        stroke="#fff"
        strokeOpacity=".75"
        strokeWidth="2"
      />
      {/* 円の中の薄い白い曲線 */}
      <path
        d="M183 118c0-22-36-25-39 2-3 28 36 27 39 3"
        fill="none"
        stroke="#fff"
        strokeOpacity=".38"
        strokeWidth="2"
      />
      {/* ナイフの根元をグラデーションで塗った図形 */}
      <path d="M355 332h86V212c-14 43-42 77-86 91z" fill="url(#heroGradient)" />
    </svg>
  )
}

/**
 * ホーム（スタート）画面。
 * @param onStart Start ボタンを押したときに呼ばれる関数
 * @returns ホーム画面の JSX
 */
function Home({ onStart }: { onStart: () => void }) {
  return (
    <main className="home-screen">
      {/* 左側：イラスト表示エリア */}
      <section className="home-art" aria-label="FindRestr food illustration">
        <HeroIllustration />
      </section>
      {/* 右側：ロゴ・タイトル・開始ボタン */}
      <section className="home-content">
        <div className="home-brand">
          {/* ロゴマーク */}
          <BrandMark />
          {/* アプリ名 */}
          <h1>FindRestr</h1>
          {/* キャッチコピー */}
          <p>Find Restaurants on Your Route</p>
          {/* 押すと onStart を呼んで検索画面へ進む */}
          <button className="primary-button start-button" onClick={onStart}>
            Start
            {/* 装飾の矢印（読み上げ対象外） */}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
    </main>
  )
}

/**
 * アプリのルートコンポーネント。URL のハッシュに応じてホーム画面と検索画面を切り替える。
 * @returns 現在の画面の JSX（引数なし）
 */
export default function App() {
  // 表示中の画面。初期値は URL ハッシュが #main-menu なら検索画面、それ以外はホーム
  const [screen, setScreen] = useState<"home" | "menu">(() =>
    window.location.hash === "#main-menu" ? "menu" : "home",
  )

  // ブラウザの戻る/進むなどでハッシュが変わったときに画面を追従させる
  useEffect(() => {
    // ハッシュ変更時に、ハッシュから画面を決めて状態に反映する
    const onHashChange = () =>
      setScreen(window.location.hash === "#main-menu" ? "menu" : "home")
    // hashchange イベントを購読する
    window.addEventListener("hashchange", onHashChange)
    // アンマウント時に購読を解除する
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  /**
   * 画面を切り替える。
   * @param next 遷移先の画面（"home" または "menu"）
   * @returns なし
   */
  const navigate = (next: "home" | "menu") => {
    // URL ハッシュを書き換えて履歴に残す（ホームはハッシュなし）
    window.location.hash = next === "menu" ? "main-menu" : ""
    // 画面の状態を更新する
    setScreen(next)
  }

  // ホームならホーム画面、それ以外なら検索画面を表示する
  return screen === "home" ? (
    // Start で検索画面へ
    <Home onStart={() => navigate("menu")} />
  ) : (
    // 検索画面からホームへ戻れるようにする
    <RestaurantSearch onHome={() => navigate("home")} />
  )
}
