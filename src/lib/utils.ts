// 条件付きでクラス名を結合する clsx と、その引数の型 ClassValue を読み込む
import { clsx, type ClassValue } from "clsx"
// Tailwind のクラスの衝突（例: p-2 と p-4）を後勝ちで解決する twMerge を読み込む
import { twMerge } from "tailwind-merge"

/**
 * Tailwind のクラス名を結合し、衝突するクラスを整理する。
 * @param inputs クラス名（文字列・配列・{ クラス名: 真偽値 } のオブジェクトなど、可変長）
 * @returns 結合・重複解決済みのクラス名文字列
 */
export function cn(...inputs: ClassValue[]) {
  // clsx で 1 つの文字列にまとめ、twMerge で衝突するクラスを解決して返す
  return twMerge(clsx(inputs))
}
