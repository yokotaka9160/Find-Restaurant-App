// 状態管理フック useState を読み込む
import { useState } from "react"

// 緯度・経度の型を読み込む（型のみ）
import type { GeoPoint } from "@/data/restaurants"

/**
 * ブラウザの位置情報で現在地を 1 回取得する
 * @returns locating: 取得中かどうか / error: エラーメッセージ（なければ null）/ locate: 取得を開始する関数
 */
export function useGeolocation() {
  // 位置情報を取得中かどうか
  const [locating, setLocating] = useState(false)
  // 取得失敗時のエラーメッセージ（成功・未実行時は null）
  const [error, setError] = useState<string | null>(null)

  /**
   * 現在地の取得を開始する。
   * @param onSuccess 取得成功時に呼ばれるコールバック（引数は現在地の座標）
   * @returns なし
   */
  const locate = (onSuccess: (point: GeoPoint) => void) => {
    // ブラウザが Geolocation API に対応していなければエラーを出して終了
    if (!("geolocation" in navigator)) {
      setError("このブラウザは位置情報に対応していません")
      return
    }
    // 取得中にする
    setLocating(true)
    // 前回のエラーを消す
    setError(null)
    // 現在地を 1 回だけ取得する
    navigator.geolocation.getCurrentPosition(
      // 成功時の処理
      (pos) => {
        // 取得中を解除
        setLocating(false)
        // 緯度・経度を GeoPoint にしてコールバックへ渡す
        onSuccess({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      // 失敗時の処理
      (err) => {
        // 取得中を解除
        setLocating(false)
        // 許可拒否かそれ以外かでメッセージを出し分ける
        setError(
          err.code === err.PERMISSION_DENIED
            ? "位置情報の利用が許可されていません"
            : "現在地を取得できませんでした",
        )
      },
      // タイムアウト 10 秒、60 秒以内のキャッシュ済み位置は再利用する
      { timeout: 10000, maximumAge: 60000 },
    )
  }

  // 状態と取得関数を呼び出し元へ返す
  return { locating, error, locate }
}
