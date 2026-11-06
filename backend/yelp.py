"""Yelp Fusion API（GET /v3/businesses/search）から店舗を取得し、Shop 形式に変換する。

API キーは環境変数 YELP_API_KEY から読み込む（ブラウザに渡さないため、必ずバックエンド経由で呼ぶ）。
https://docs.developer.yelp.com/reference/v3_business_search
"""

# 型ヒントを遅延評価する（新しい型表記を使えるようにする）
from __future__ import annotations

# 環境変数を読むための os
import os
# 「値または None」を表す型
from typing import Optional
# URL のパスに入れる文字列をエスケープする
from urllib.parse import quote

# 非同期 HTTP クライアント
import httpx

# カテゴリ alias を日本語名に変換する関数
from categories_ja import ja_title

# Yelp の店舗検索 API の URL
YELP_SEARCH_URL = "https://api.yelp.com/v3/businesses/search"
# Yelp の店舗詳細 API の URL（末尾に店舗 ID を付ける）
YELP_BUSINESS_URL = "https://api.yelp.com/v3/businesses"
YELP_MAX_LIMIT = 50  # 1 リクエストで取得できる最大件数
# 飲食店全体（Yelp の親カテゴリ）。ジャンルは結果の categories から作り、絞り込みは呼び出し側で行う
YELP_CATEGORIES = "restaurants"


def api_key() -> Optional[str]:
    """Yelp の API キーを返す。

    引数: なし
    返り値: 環境変数 YELP_API_KEY の値（未設定または空文字なら None）
    """
    # 空文字も None 扱いにする
    return os.environ.get("YELP_API_KEY") or None


# 都道府県が未指定のときに使う既定値
DEFAULT_PREFECTURE = "東京都"
# カテゴリがない店舗の代表ジャンル名
UNKNOWN_GENRE = "その他"

# Yelp の価格帯（$〜$$$$）→ 1人あたりの目安予算（円）
PRICE_TO_BUDGET = {1: 1000, 2: 3000, 3: 7000, 4: 15000}
# 価格帯が不明なときの目安予算（円）
UNKNOWN_PRICE_BUDGET = 3000

# 「駐車場あり」とみなす business_parking の種類（駐車場・立体駐車場・バレー・提携駐車場）。
# street（路上駐車）は駐車場とはみなさない
PARKING_KINDS = ("lot", "garage", "valet", "validated")


class YelpError(Exception):
    """Yelp API の呼び出しに失敗したことを表す例外（メッセージは日本語）"""

    pass


def has_parking(business_parking: object) -> Optional[bool]:
    """Yelp の business_parking 属性から、駐車場があるかを判定する。

    引数:
        business_parking: {"lot": bool, "garage": bool, "street": bool, ...} の dict（ない場合は None）
    返り値:
        PARKING_KINDS のいずれかが True なら True、すべて False なら False、情報がなければ None
    """
    # dict でなければ情報なし
    if not isinstance(business_parking, dict):
        return None
    # 駐車場の種類のどれかが True なら駐車場あり
    return any(business_parking.get(k) is True for k in PARKING_KINDS)


def as_bool(value: object) -> Optional[bool]:
    """真偽値ならそのまま、それ以外（属性がないなど）なら None を返す。

    引数:
        value: Yelp の属性の値
    返り値:
        True / False / None
    """
    return value if isinstance(value, bool) else None


def to_shop(business: dict, prefecture: Optional[str], area: Optional[str]) -> dict:
    """Yelp の business 1 件を、フロントと共通の Shop 形式の dict に変換する。

    引数:
        business: Yelp API の businesses 配列の要素
        prefecture: 検索した都道府県（現在地検索なら None）
        area: 検索した市区町村・エリア（未指定なら None）
    返り値:
        Shop 形式の dict
    """
    # 価格帯 "$$" などの文字数（1〜4）。不明なら 0
    price = len(business.get("price") or "")
    # カテゴリを {alias, 日本語 title} のリストにする（alias がないものは除く）
    categories = [
        {"alias": c["alias"], "title": ja_title(c["alias"], c.get("title") or c["alias"])}
        for c in business.get("categories", [])
        if c.get("alias")
    ]
    # 住所情報
    location = business.get("location", {})
    # 表示用住所の行をスペースでつなぐ
    address = " ".join(location.get("display_address", []))
    # 座標（ない場合は空 dict）
    coords = business.get("coordinates") or {}
    # 設備などの属性（ない場合は空 dict）
    attributes = business.get("attributes") or {}
    return {
        "id": business["id"],  # Yelp の店舗 ID
        "name": business.get("name", ""),  # 店名
        "prefecture": prefecture or "",  # 都道府県（なければ空文字）
        # エリア指定時はその名前、未指定（都道府県全域・現在地）なら店舗住所の city
        "area": area or location.get("city") or "",
        "distance": business.get("distance"),  # 検索中心からの距離（m）
        "lat": coords.get("latitude"),  # 緯度
        "lng": coords.get("longitude"),  # 経度
        "genre": categories[0]["title"] if categories else UNKNOWN_GENRE,  # 代表ジャンル
        "categories": categories,  # カテゴリ一覧
        "budget": PRICE_TO_BUDGET.get(price, UNKNOWN_PRICE_BUDGET),  # 価格帯から目安予算へ
        "rating": float(business.get("rating") or 0),  # 評価
        "review_count": int(business.get("review_count") or 0),  # レビュー数
        # 説明文：「カテゴリ・カテゴリ｜住所」（空の要素は除く）
        "description": "｜".join(
            s for s in ("・".join(c["title"] for c in categories), address) if s
        ),
        "image": business.get("image_url") or "",  # 画像 URL（なければ空文字）
        "url": business.get("url"),  # Yelp の店舗ページ
        "parking": has_parking(attributes.get("business_parking")),  # 駐車場の有無（不明なら None）
        # 大人数で利用できるか（Yelp の「グループ向け」属性。不明なら None）
        "good_for_groups": as_bool(attributes.get("restaurants_good_for_groups")),
    }


async def search_shops(
    prefecture: Optional[str],
    area: Optional[str],
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_m: int = 5000,
) -> tuple[int, list[dict]]:
    """Yelp で飲食店を検索し (Yelp 上の該当総件数, Shop 形式の店舗リスト) を返す。

    lat / lng があれば現在地から radius_m 以内、なければ「<エリア>, <都道府県>」で検索する。
    ジャンル・評価・予算の絞り込みは呼び出し側（filter_shops）で行う。

    引数:
        prefecture: 都道府県名（None なら東京都）
        area: 市区町村・エリア名（None なら都道府県全域）
        lat, lng: 中心座標（両方あれば座標で検索）
        radius_m: 座標検索の半径（m）
    返り値:
        (総件数, 店舗リスト) のタプル
    例外:
        YelpError: API キー未設定・接続失敗・200 以外の応答のとき
    """
    # API キーを取得し、なければエラー
    key = api_key()
    if not key:
        raise YelpError("YELP_API_KEY が設定されていません")

    # 共通の検索パラメータ
    params: dict = {
        "categories": YELP_CATEGORIES,  # 飲食店に限定
        "locale": "ja_JP",  # 日本語ロケール
        "limit": YELP_MAX_LIMIT,  # 最大件数
        "sort_by": "best_match",  # Yelp のおすすめ順
    }
    if lat is not None and lng is not None:
        # 座標検索：中心と半径を指定し、都道府県・エリアは使わない
        params.update(latitude=lat, longitude=lng, radius=radius_m)
        prefecture = area = None
    else:
        # 地名検索：「エリア, 都道府県」または「都道府県」を location に指定
        prefecture = prefecture or DEFAULT_PREFECTURE
        params["location"] = f"{area}, {prefecture}" if area else prefecture
    # タイムアウト 10 秒の HTTP クライアントで呼び出す
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            res = await client.get(
                YELP_SEARCH_URL,
                params=params,
                # API キーを Bearer トークンとして送る
                headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
            )
        except httpx.HTTPError as e:
            # 通信エラーは YelpError に変換する
            raise YelpError(f"Yelp API に接続できません: {e}") from e

    # 200 以外はエラー（本文の先頭 200 文字を含める）
    if res.status_code != 200:
        raise YelpError(f"Yelp API error {res.status_code}: {res.text[:200]}")

    # レスポンスを JSON として読む
    data = res.json()
    # 各 business を Shop 形式に変換する
    shops = [to_shop(b, prefecture, area) for b in data.get("businesses", [])]
    # 総件数（なければ取得件数）と店舗リストを返す
    return int(data.get("total", len(shops))), shops


async def get_shop(client: httpx.AsyncClient, business_id: str) -> Optional[dict]:
    """Yelp の店舗詳細 API で 1 店舗の情報を取得し、Shop 形式で返す。

    引数:
        client: Authorization ヘッダー付きの HTTP クライアント（make_client で作る）
        business_id: Yelp の店舗 ID
    返り値:
        Shop 形式の dict（店舗が見つからなければ None）
    例外:
        YelpError: 接続失敗・404 以外のエラー応答のとき
    """
    try:
        # 店舗 ID は URL のパスに入れるのでエスケープする
        res = await client.get(
            f"{YELP_BUSINESS_URL}/{quote(business_id, safe='')}", params={"locale": "ja_JP"}
        )
    except httpx.HTTPError as e:
        # 通信エラーは YelpError に変換する
        raise YelpError(f"Yelp API に接続できません: {e}") from e
    # 閉店・削除などで店舗が見つからない
    if res.status_code == 404:
        return None
    # それ以外のエラー（本文の先頭 200 文字を含める）
    if res.status_code != 200:
        raise YelpError(f"Yelp API error {res.status_code}: {res.text[:200]}")
    # 都道府県・エリアは検索条件がないので、店舗住所の city をエリアにする
    return to_shop(res.json(), None, None)


def make_client() -> httpx.AsyncClient:
    """Yelp API 用の HTTP クライアントを作る（複数の店舗詳細をまとめて取得するときに共有する）。

    引数: なし
    返り値: API キーを Authorization ヘッダーに設定した httpx.AsyncClient
    例外:
        YelpError: API キーが設定されていないとき
    """
    # API キーを取得し、なければエラー
    key = api_key()
    if not key:
        raise YelpError("YELP_API_KEY が設定されていません")
    # タイムアウト 10 秒、Bearer トークン付きのクライアント
    return httpx.AsyncClient(
        timeout=10, headers={"Authorization": f"Bearer {key}", "Accept": "application/json"}
    )
