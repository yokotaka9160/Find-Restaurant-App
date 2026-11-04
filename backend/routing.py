"""ルート検索（OSRM）と地名検索（Nominatim）、ルートからの距離計算。

- OSRM: https://project-osrm.org/docs/v5.24.0/api/#route-service
  既定は公開デモサーバー（1 秒 1 リクエスト程度まで・商用不可）。自前のサーバーは OSRM_URL で指定する。
- Nominatim: https://nominatim.org/release-docs/latest/api/Search/
  利用規約により、入力中の自動補完には使わない（検索ボタンを押したときだけ呼ぶ）。
"""

# 型ヒントを遅延評価する
from __future__ import annotations

# 三角関数・距離計算に使う
import math
# 環境変数を読むための os
import os
# データ保持用クラスを簡潔に定義するデコレータ
from dataclasses import dataclass

# 非同期 HTTP クライアント
import httpx

# docker compose から空文字で渡ることがあるので `or` で既定値にする
OSRM_URL = (os.environ.get("OSRM_URL") or "https://router.project-osrm.org").rstrip("/")
# 移動手段のプロファイル（既定は車）
OSRM_PROFILE = os.environ.get("OSRM_PROFILE") or "driving"
# Nominatim の検索 API の URL
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Nominatim はアプリを識別できる User-Agent が必須
USER_AGENT = "FindRestr/1.0 (restaurant search demo)"

# 距離計算用にルートを間引く間隔（m）。検索幅（100m〜）より十分小さければ精度に影響しない
SIMPLIFY_M = 20


class RoutingError(Exception):
    """ルート検索・地名検索の失敗を表す例外。HTTP ステータスコードを持つ"""

    def __init__(self, message: str, status_code: int = 502):
        """
        引数:
            message: エラーメッセージ（日本語。そのまま画面に表示される）
            status_code: API が返す HTTP ステータス（既定 502）
        """
        # 親クラスにメッセージを渡す
        super().__init__(message)
        # ステータスコードを保持する
        self.status_code = status_code


# (緯度, 経度) のタプル型の別名
LatLng = tuple[float, float]


@dataclass
class Route:
    """OSRM から取得したルート"""

    coordinates: list[LatLng]  # (lat, lng) の列（間引き済み）
    distance_m: float  # 総距離（m）
    duration_s: float  # 所要時間（秒）


# ------------------------------------------------------------------ #
# OSRM                                                               #
# ------------------------------------------------------------------ #


async def fetch_route(origin: LatLng, destination: LatLng) -> Route:
    """OSRM で出発地から目的地までのルートを取得する。

    引数:
        origin: 出発地 (lat, lng)
        destination: 目的地 (lat, lng)
    返り値:
        間引き済みのルート
    例外:
        RoutingError: 接続失敗（502）・ルートなし（404）・その他の失敗（502）
    """
    # OSRM の座標は「経度,緯度」の順
    coords = f"{origin[1]},{origin[0]};{destination[1]},{destination[0]}"
    # ルート API の URL を組み立てる
    url = f"{OSRM_URL}/route/v1/{OSRM_PROFILE}/{coords}"
    # 全形状を GeoJSON で 1 本だけ、道順案内なしで取得する
    params = {"overview": "full", "geometries": "geojson", "alternatives": "false", "steps": "false"}
    # タイムアウト 15 秒で呼び出す
    async with httpx.AsyncClient(timeout=15, headers={"User-Agent": USER_AGENT}) as client:
        try:
            res = await client.get(url, params=params)
        except httpx.HTTPError as e:
            # 通信エラーは RoutingError に変換する
            raise RoutingError(f"ルート検索サーバーに接続できません: {e}") from e

    # JSON 応答なら読み、それ以外は空 dict
    data = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
    # ルートが存在しない（海を渡るなど）ときは 404
    if data.get("code") == "NoRoute":
        raise RoutingError("ルートが見つかりませんでした", status_code=404)
    # その他の失敗
    if res.status_code != 200 or data.get("code") != "Ok" or not data.get("routes"):
        raise RoutingError(f"ルート検索に失敗しました（{data.get('code') or res.status_code}）")

    # 最初のルートを使う
    route = data["routes"][0]
    # GeoJSON の [lng, lat] を (lat, lng) に並べ替える
    points = [(lat, lng) for lng, lat in route["geometry"]["coordinates"]]
    # 座標を間引いて Route にして返す
    return Route(
        coordinates=simplify(points, SIMPLIFY_M),
        distance_m=float(route["distance"]),
        duration_s=float(route["duration"]),
    )


# ------------------------------------------------------------------ #
# Nominatim                                                          #
# ------------------------------------------------------------------ #

# 検索語 → 結果のキャッシュ（同じ語で何度も Nominatim を呼ばないため）
_geocode_cache: dict[str, list[dict]] = {}


async def geocode(query: str) -> list[dict]:
    """地名・住所から候補を最大 5 件返す [{name, lat, lng}]（日本国内のみ）

    引数:
        query: 地名・住所・駅名など
    返り値:
        候補のリスト
    例外:
        RoutingError: 接続失敗・200 以外の応答のとき
    """
    # 前後の空白を除いたものをキーにする
    key = query.strip()
    # キャッシュにあればそれを返す
    if key in _geocode_cache:
        return _geocode_cache[key]

    # 検索パラメータ
    params = {
        "q": key,  # 検索語
        "format": "jsonv2",  # 応答形式
        "limit": 5,  # 最大 5 件
        "countrycodes": "jp",  # 日本国内に限定
        "accept-language": "ja",  # 日本語の地名で返す
    }
    # タイムアウト 10 秒で呼び出す
    async with httpx.AsyncClient(timeout=10, headers={"User-Agent": USER_AGENT}) as client:
        try:
            res = await client.get(NOMINATIM_URL, params=params)
        except httpx.HTTPError as e:
            # 通信エラーは RoutingError に変換する
            raise RoutingError(f"地名検索サーバーに接続できません: {e}") from e
    # 200 以外はエラー
    if res.status_code != 200:
        raise RoutingError(f"地名検索に失敗しました（{res.status_code}）")

    # 応答を {name, lat, lng} のリストに変換する
    results = [
        {"name": r.get("display_name", key), "lat": float(r["lat"]), "lng": float(r["lon"])}
        for r in res.json()
    ]
    # キャッシュに保存して返す
    _geocode_cache[key] = results
    return results


# ------------------------------------------------------------------ #
# 距離計算（ルート周辺の狭い範囲なので平面近似で十分）                   #
# ------------------------------------------------------------------ #

# 緯度 1 度あたりの距離（m）
_M_PER_DEG_LAT = 110_540.0
# 赤道上での経度 1 度あたりの距離（m）
_M_PER_DEG_LNG_EQUATOR = 111_320.0


def _to_xy(p: LatLng, cos_lat: float) -> tuple[float, float]:
    """緯度経度を平面座標（m）に変換する。

    引数:
        p: (lat, lng)
        cos_lat: 基準緯度の cos（経度 1 度の長さの補正に使う）
    返り値:
        (x, y)（m）。x は東西、y は南北
    """
    return p[1] * _M_PER_DEG_LNG_EQUATOR * cos_lat, p[0] * _M_PER_DEG_LAT


def simplify(points: list[LatLng], min_gap_m: float) -> list[LatLng]:
    """前の点から min_gap_m 未満の点を間引く（始点・終点は残す）

    引数:
        points: (lat, lng) の列
        min_gap_m: 残す点どうしの最小間隔（m）
    返り値:
        間引いた (lat, lng) の列
    """
    # 2 点以下なら間引く必要がない
    if len(points) <= 2:
        return points
    # 始点の緯度で cos を求める
    cos_lat = math.cos(math.radians(points[0][0]))
    # 始点は必ず残す
    result = [points[0]]
    # 最後に残した点の平面座標
    last = _to_xy(points[0], cos_lat)
    # 始点・終点を除く中間の点を順に見る
    for p in points[1:-1]:
        xy = _to_xy(p, cos_lat)
        # 最後に残した点から min_gap_m 以上離れていれば残す
        if math.dist(xy, last) >= min_gap_m:
            result.append(p)
            last = xy
    # 終点は必ず残す
    result.append(points[-1])
    return result


class RouteGeometry:
    """ルート（折れ線）に対する距離計算。座標は前計算しておく"""

    def __init__(self, points: list[LatLng]):
        """
        引数:
            points: ルートの (lat, lng) の列
        """
        # 全点の平均緯度を基準にする
        lat0 = sum(p[0] for p in points) / len(points)
        # 基準緯度の cos
        self.cos_lat = math.cos(math.radians(lat0))
        # 各点の平面座標
        self.xy = [_to_xy(p, self.cos_lat) for p in points]
        # 元の緯度経度
        self.points = points
        # 始点から各頂点までの道のり（m）
        self.cumulative = [0.0]
        # 隣り合う点の距離を足し上げていく
        for a, b in zip(self.xy, self.xy[1:]):
            self.cumulative.append(self.cumulative[-1] + math.dist(a, b))

    @property
    def length(self) -> float:
        """ルートの全長（m）を返す（引数なし）"""
        return self.cumulative[-1]

    def locate(self, p: LatLng) -> tuple[float, float]:
        """(ルートまでの最短距離, その地点の始点からの道のり) を m で返す

        引数:
            p: 調べる地点 (lat, lng)
        返り値:
            (最短距離, 道のり)（いずれも m）
        """
        # 地点を平面座標にする
        px, py = _to_xy(p, self.cos_lat)
        # これまでの最短距離とそのときの道のり
        best_d, best_along = math.inf, 0.0
        # 各区間（a→b）について調べる
        for i, ((ax, ay), (bx, by)) in enumerate(zip(self.xy, self.xy[1:])):
            # 区間のベクトル
            dx, dy = bx - ax, by - ay
            # 区間の長さの 2 乗
            seg2 = dx * dx + dy * dy
            # 地点を区間に射影した位置（0〜1 に制限。長さ 0 の区間は 0）
            t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
            # 区間上の最も近い点
            cx, cy = ax + t * dx, ay + t * dy
            # 地点からその点までの距離
            d = math.hypot(px - cx, py - cy)
            # 最短なら更新する
            if d < best_d:
                best_d = d
                # 区間の始点までの道のり + 区間内の進んだ長さ
                best_along = self.cumulative[i] + t * math.sqrt(seg2)
        return best_d, best_along

    def sample(self, spacing_m: float) -> list[LatLng]:
        """ルート上に spacing_m 間隔で点を取る（始点・終点を含む）

        引数:
            spacing_m: 点の間隔（m）。実際の間隔は全長を等分した長さ（spacing_m 以下）になる
        返り値:
            ルート上の (lat, lng) の列
        """
        # 分割数（最低 1）
        n = max(1, math.ceil(self.length / spacing_m))
        # 始点からの道のりで表した目標位置（0, L/n, 2L/n, …, L）
        targets = [self.length * k / n for k in range(n + 1)]
        # 結果のリストと、現在見ている区間の番号
        result, i = [], 0
        for t in targets:
            # 目標位置を含む区間まで進める（targets は昇順なので i は戻らない）
            while i < len(self.cumulative) - 2 and self.cumulative[i + 1] < t:
                i += 1
            # 区間の長さ
            seg = self.cumulative[i + 1] - self.cumulative[i]
            # 区間内での割合（長さ 0 の区間は 0）
            r = 0.0 if seg == 0 else (t - self.cumulative[i]) / seg
            # 区間の両端の緯度経度
            (alat, alng), (blat, blng) = self.points[i], self.points[i + 1]
            # 両端を割合 r で線形補間した点を追加する
            result.append((alat + (blat - alat) * r, alng + (blng - alng) * r))
        return result
