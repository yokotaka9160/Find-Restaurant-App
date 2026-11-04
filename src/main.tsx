// React 本体を読み込む（StrictMode を使うため）
import React from 'react'
// ブラウザの DOM に React を描画するためのクライアント API を読み込む
import ReactDOM from 'react-dom/client'
// アプリのルートコンポーネントを読み込む
import App from './App'
// グローバル CSS（Tailwind とアプリ全体のスタイル）を読み込む
import './index.css'

// index.html の #root 要素を React の描画先（ルート）として作成し、App を描画する
ReactDOM.createRoot(document.getElementById('root')!).render(
  // 開発時に副作用の二重実行などで潜在的な問題を検出する StrictMode で包む
  <React.StrictMode>
    {/* アプリ本体 */}
    <App />
  </React.StrictMode>,
)
